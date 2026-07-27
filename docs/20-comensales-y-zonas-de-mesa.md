# Comensales por Sesión y Zonas de Mesas

## Objetivo

Dos mejoras independientes al módulo `floor`, pedidas para preparar métricas futuras de gasto por comensal y para poder avisar (sin bloquear) cuando un mesero abre una mesa que no es la que suele atender:

1. **Cantidad de comensales**: al abrir una `TableSession` ahora se registra cuánta gente se sentó (`guestCount`). Es un dato operativo puro — no se enmascara ni depende de ningún flag de sucursal, a diferencia de `assignedStaffUserId`.
2. **Zonas de mesas**: una sucursal puede agrupar mesas en zonas (ej. "Terraza", "Salón principal", "Barra") y asignar qué miembros del staff atienden cada zona. Es informativo, no bloqueante: cualquier mesero con acceso a la sucursal puede seguir abriendo cualquier mesa; la zona es la base para que el frontend pueda avisar ("estás abriendo una mesa fuera de tu zona") sin impedir la operación.

## Modelo de datos

- `TableSession.guestCount: Int?` — opcional (nunca se fuerza a completar sesiones viejas), con `CHECK (guest_count IS NULL OR guest_count > 0)`. En la práctica siempre viene informado porque `OpenTableSessionDto.guestCount` es requerido (entre 1 y 30) para sesiones nuevas; queda `NULL` únicamente en filas históricas previas a esta migración.
- `TableZone`: `id`, `branchId` (FK a `Branch`, `ON DELETE CASCADE`), `name`, único por `(branchId, name)`.
- `Table.zoneId: String?` — FK a `TableZone`, `ON DELETE SET NULL` (si se borra la zona, las mesas quedan sin zona, no se borran).
- `StaffUserZone`: tabla puente `staffUserId` × `zoneId`, ambas `ON DELETE CASCADE`, única por `(staffUserId, zoneId)`. Reemplazo completo de membresía en cada `PUT /zones/:zoneId/staff` (se borra todo lo anterior y se inserta lo nuevo dentro de una transacción).

### Índice único parcial: cierre de una condición de carrera preexistente

Migración `20260727130000_table_session_guests_and_zones` agrega también:

```sql
CREATE UNIQUE INDEX "table_sessions_one_active_per_table" ON "table_sessions" ("table_id") WHERE "status" IN ('OPEN', 'PAYMENT_COMPLETED');
```

Esto no tiene relación directa con comensales ni zonas — es un hallazgo de una revisión de arquitectura previa que se aprovechó de tener que tocar esta migración de todos modos: `OpenTableSessionService` chequeaba una sesión activa existente con un `findFirst` dentro de la transacción y recién después hacía el `create`. Dos requests concurrentes abriendo la misma mesa podían pasar ambas el `findFirst` (ninguna ve la sesión de la otra todavía) y terminar creando dos sesiones activas para la misma mesa. El índice parcial lo bloquea a nivel de base de datos; `OpenTableSessionService.execute` ahora envuelve la transacción en un `try/catch` que traduce la violación (`Prisma.PrismaClientKnownRequestError` con `code: 'P2002'`) al mismo `ConflictException` que ya lanzaba el chequeo explícito — mismo mensaje, mismo comportamiento observable para el cliente, la diferencia es solo que ahora hay un segundo cinturón de seguridad a nivel de base de datos para la misma regla de negocio.

## Endpoints nuevos

Todos bajo `/api/v1/floor`, mismo guard que el resto del módulo (`JwtAuthGuard` + `ProfileTypeGuard`, `RequireProfileType(STAFF)`).

- `GET /zones?branchId=` — lista las zonas de una sucursal con sus `tableIds` y `staffUserIds`. Roles: `ADMIN`, `SUPERVISOR`, `WAITER`, `CASHIER`, `KITCHEN` (mismos que `GET /tables`).
- `POST /zones` — crea una zona (`{ branchId, name }`). Roles: `ADMIN`, `SUPERVISOR`. `409 ConflictException` si ya existe una zona con ese nombre en la sucursal.
- `PATCH /zones/:zoneId` — renombra una zona. Mismo `409` por nombre duplicado.
- `DELETE /zones/:zoneId` — elimina una zona. Las mesas que apuntaban a ella quedan con `zoneId: null` (`ON DELETE SET NULL`); las membresías de staff se borran en cascada.
- `PATCH /tables/:tableId/zone` — asigna o quita la zona de una mesa (`{ zoneId? }`). Ausencia de la clave `zoneId` en el body se trata igual que `zoneId: null` (desasigna). Si se manda un `zoneId`, se valida que la zona exista **en la misma sucursal** de la mesa — `400 BadRequestException` si no.
- `PUT /zones/:zoneId/staff` — reemplaza el equipo asignado a una zona (`{ staffUserIds: string[] }`). Valida que cada staff tenga `StaffUserBranchRole` activo con rol operativo (`ADMIN`/`SUPERVISOR`/`WAITER`/`CASHIER`) en esa sucursal y `StaffUser.status: ACTIVE` — mismo chequeo compuesto que ya usa `AssignTableSessionService` (doc 18), extraído a `FLOOR_ASSIGN_ROLES` en `floor-assignment-roles.ts` para no duplicarlo.
- `GET /branch-staff?branchId=` — lista `{ staffUserId, firstName, lastName }` del equipo con rol operativo activo en la sucursal, para poblar el selector de "asignar zona a...". Roles: **solo** `ADMIN`, `SUPERVISOR` (no todos los roles de piso — un mesero normal no debe poder listar nombres de compañeros).

## Dónde más aparece `guestCount` / `zoneId`

- `open-table-session.service.ts`: `guestCount` se guarda tal cual viene del DTO (validado `1..30`) al crear la sesión.
- `list-tables.service.ts`: cada mesa expone `zoneId` (columna directa, sin include nuevo) y `currentSession.guestCount` si hay sesión activa.
- `get-current-table-session.service.ts`, `close-table-session.service.ts`, `assign-table-session.service.ts`: exponen `guestCount` de la sesión en su respuesta, sin enmascarar.
- `set-table-zone.service.ts`: devuelve el `TableResponseDto` completo de la mesa actualizada, incluyendo su sesión activa si la tiene (con el mismo enmascarado de `assignedStaffUserId` según `BranchSettings.tableAssignmentEnabled` que usa `list-tables.service.ts`, por consistencia).

## Verificación

173 tests (`jest`), incluye tests nuevos para `OpenTableSessionService` (DTO con `guestCount`, violación del índice único parcial vía `P2002`), `CreateTableZoneService` (creación feliz, nombre duplicado), `SetZoneStaffService` (reemplazo feliz, staff sin rol activo rechazado) y `SetTableZoneService` (asignación feliz, zona de otra sucursal rechazada, desasignación por ausencia de `zoneId`). `npm run build` y `npm run lint` limpios. Migración `20260727130000_table_session_guests_and_zones` aplicada con `prisma migrate deploy` (sin drift, confirmado con `prisma migrate status`) y `prisma generate` corrido después.

Se corrió además una revisión adversarial de consistencia de contrato contra `sazono-ui` (los dos repos se implementaron en paralelo por agentes distintos, sin verse entre sí). Confirmó que los 7 endpoints nuevos coinciden exactamente en path/método/forma de body y respuesta con lo que consume el frontend, que `GET /branch-staff` nunca queda expuesto a un mesero común, y que el aviso de "mesa fuera de tu zona" del frontend nunca bloquea la apertura. Encontró un único hallazgo real, exclusivo del frontend (el botón de gestión de zonas no respetaba `tableAssignmentEnabled`) — sin impacto en este repo, ya corregido y documentado en doc 17 de `sazono-ui`.
