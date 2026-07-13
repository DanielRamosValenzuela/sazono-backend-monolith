# Branch Access, Permisos de Mesero y Estaciones

## Objetivo

Este slice resuelve tres cosas relacionadas que salieron de una revision de control de acceso: deuda tecnica de autorizacion duplicada, un bug real que bloqueaba el flujo de comanda del mesero, y permisos de mas que tenia el rol `WAITER`.

## BranchAccessService compartido

Antes existian 8 copias casi identicas de la misma logica de autorizacion por sucursal, una por modulo: `staff-admin-access.service.ts`, `branches-staff-access.service.ts`, `orders-branch-access.service.ts`, `kitchen-branch-access.service.ts`, `menus-branch-admin-access.service.ts`, `floor-branch-access.service.ts`, `billing-branch-access.service.ts`, `payments-branch-access.service.ts`, mas `analytics-branch-access.service.ts`. Todas hacian el mismo query (`staffUser.findFirst` + `branchRoles` activos) con pequenas variaciones.

Se consolidaron en un unico `src/common/branch-access/branch-access.service.ts`, registrado como modulo global (`BranchAccessModule`, igual que `PrismaModule`), con dos metodos:

- `ensureAccess(authUser, branchId, allowedRoles): Promise<BranchAccessContext>` — valida que el staff tenga alguno de los roles permitidos en esa sucursal especifica. Reemplaza a los 6 servicios que ya tenian esta forma, y a `menus-branch-admin-access.service.ts` (que era un caso particular con `allowedRoles` fijo en `[Role.ADMIN]`).
- `getStaffContext(authUser): Promise<StaffContext>` — devuelve `memberBranchIds` y `adminBranchIds` del staff a traves de TODAS sus sucursales, sin filtrar por una branch especifica. Reemplaza a `staff-admin-access.service.ts` (que se llamaba `getAdminContext` y validaba internamente `adminBranchIds.size > 0`, chequeo que ahora vive explicito en cada call site que lo necesita: `create-staff-user.service.ts`, `update-staff-user.service.ts`, `list-staff-users.service.ts`) y a `branches-staff-access.service.ts` (mismo nombre de metodo, sin cambios de firma).

Los 8 archivos duplicados fueron eliminados. Cualquier modulo nuevo que necesite validar acceso por sucursal debe inyectar `BranchAccessService` directamente (no requiere importar ningun modulo adicional, es global).

## Cupo de sucursales y login por slug

Ver doc 05 (Auth and Restaurant Bootstrap) — quedan documentados ahi porque son parte del mismo flujo de auth/bootstrap.

## Permisos de `WAITER` corregidos

Se detecto en una revision que el rol `WAITER` tenia una mezcla de permisos de menos y de mas respecto al alcance deseado (abrir mesa, cerrar mesa pagada, enviar comanda a cocina — nada mas):

**Bug real corregido (bloqueaba el flujo central del mesero):**

- `GET /menus?branchId=` y `GET /menus/:id` eran ADMIN-only. El flujo de "agregar orden" del frontend depende de estos dos endpoints para cargar el menu y armar la comanda — un `WAITER` sin rol `ADMIN` en su sucursal recibia 403 al intentar ver el menu y no podia enviar ninguna comanda. Se agrego `Role.WAITER` a los `allowedRoles` de `list-menus.service.ts` y `get-menu-detail.service.ts` (solo lectura; los endpoints de escritura de carta siguen ADMIN-only).

**Permisos de mas removidos** (el `WAITER` ya NO puede):

- `POST /orders/:id/deliver` — entregar una orden
- `POST /orders/:id/cancel` — cancelar una orden (ni siquiera pre-produccion)
- `GET /billing/branches/:id/open-bills` — ver todas las cuentas abiertas de la sucursal (es una vista de caja/supervisor)
- `GET /payments/bills/:id` — ver historial completo de pagos de una cuenta
- `POST /payments/bills/:id/splits` y `GET .../splits/current` — crear o ver split de cuenta

Para el caso de un QR de pago fallido, el `WAITER` no necesita historial de pagos: ya tiene acceso a `GET /billing/table-sessions/:id/current-bill` (estado y saldo pendiente de la cuenta), suficiente para saber que la cuenta quedo pendiente y derivar al cliente a caja.

## CRUD de estaciones de preparacion completado

Antes solo existia `POST` (crear) y `GET` (listar) para `PreparationStation` — no habia forma de renombrar, cambiar tipo o desactivar una estacion ya creada sin tocar la base directamente.

Nuevo endpoint: `PATCH /api/v1/menus/preparation-stations/:preparationStationId` (solo `ADMIN` de la sucursal), acepta `name`, `stationType` y/o `status` (`ACTIVE`/`INACTIVE`) de forma parcial. Valida que el nuevo nombre no choque con otra estacion activa de la misma sucursal (mismo criterio case-insensitive que la creacion).

## Lo que se evaluo y se decidio NO hacer ahora

Durante la misma revision se identifico que el modulo `kitchen` no tiene aislamiento granular por estacion: cualquier staff con rol `KITCHEN` o `BAR` en una sucursal puede ver los tickets de TODAS las estaciones de esa sucursal (el filtro `preparationStationId` en `GET /kitchen/station-tickets` es opcional, no obligatorio por asignacion de staff). Se decidio conscientemente diferir esto:

- no es una fuga de datos entre sucursales (tenant isolation), es "el personal de cocina ve toda la cocina de su propia sucursal" — practica comun en restaurantes chicos/medianos con una sola pantalla de cocina compartida
- si en el futuro se necesita (ej. una estacion de jugos con personal dedicado que no debe ver comandas de cocina caliente), se puede resolver primero a nivel de UI (fijando `preparationStationId` en la URL de esa pantalla especifica) antes de invertir en una migracion de schema nueva (relacion staff-a-estacion especifica, hoy `StaffUserBranchRole` no tiene ese nivel de granularidad)
