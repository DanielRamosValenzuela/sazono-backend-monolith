# Asignación Formal de Mesas a un Mesero

## Objetivo

Resuelve el backlog #1 de doc 17: `TableSession.openedByStaffUserId` era la única aproximación disponible a "de quién es esta mesa", y no cubre cambios de turno (si un mesero releva a otro a mitad de servicio, ese campo no cambia — sigue apuntando a quien abrió la sesión originalmente). Se agrega una asignación explícita y mutable, separada de ese campo, **opcional por sucursal**.

## Modelo de datos

- `BranchSettings.tableAssignmentEnabled: Boolean @default(false)` — apagado por defecto. No cambia el comportamiento de ninguna sucursal existente hasta que un `ADMIN` lo active explícitamente desde `PATCH /branches/:id`.
- `TableSession.assignedStaffUserId: String? @db.Uuid` — FK a `StaffUser`, `ON DELETE SET NULL`. Separado de `openedByStaffUserId`, que sigue siendo inmutable (registro de auditoría de quién abrió la sesión) y de `closedByStaffUserId`.

Migración `20260721170000_add_table_assignment` escrita a mano, no generada con `prisma migrate dev`. Este proyecto no puede correr ese comando contra la base de Supabase real: la migración inicial (`20260703101000_init_foundation`) referencia `auth.users` (schema de Supabase Auth), y eso rompe tanto la shadow database (`P3018: schema "auth" does not exist`) como `prisma migrate diff --from-config-datasource` contra el datasource real (`P4002: cross schema references`). El flujo que sí funciona sin tocar shadow DB ni introspección:

1. Escribir el `.sql` a mano, mirroreando exactamente el estilo de una migración anterior que haga lo mismo (`ALTER TABLE ... ADD COLUMN`, `ADD CONSTRAINT ..._fkey FOREIGN KEY ... ON DELETE SET NULL ON UPDATE CASCADE`, mismo patrón de nombres).
2. `prisma migrate status` para confirmar que no hay drift antes de aplicar.
3. `prisma migrate deploy` (no usa shadow DB, solo aplica migraciones pendientes en orden).

## Endpoint nuevo

`POST /api/v1/floor/table-sessions/:tableSessionId/assign` (`AssignTableSessionService`)

- Body opcional `{ staffUserId? }`. Si se omite, el solicitante se autoasigna la mesa.
- `WAITER`/`CASHIER`: solo pueden autoasignarse. Si envían un `staffUserId` distinto al propio, `403 ForbiddenException`.
- `ADMIN`/`SUPERVISOR`: pueden asignar a cualquier staff con rol operativo activo en esa sucursal (`ADMIN`, `SUPERVISOR`, `WAITER` o `CASHIER`).
- `400 BadRequestException` si `BranchSettings.tableAssignmentEnabled` es `false` para la sucursal de la sesión — la función tiene que estar prendida para poder asignar o reasignar, no solo para leer.
- `400 BadRequestException` si la sesión no está activa (`OPEN`/`PAYMENT_COMPLETED`).
- Valida que el staff destino tenga un `StaffUserBranchRole` con `status: ACTIVE` y rol operativo en esa sucursal, **y que su propio `StaffUser.status` también sea `ACTIVE`**. Este segundo chequeo se agregó después de una revisión adversarial que detectó que un staff desactivado (ej. despedido) seguía siendo un destino válido de reasignación mientras nadie tocara explícitamente su fila de rol: `PATCH /staff/:id` con solo `{"status":"DISABLED"}` (una desactivación normal) no toca `StaffUserBranchRole` — ver `update-staff-user.service.ts`. Sin este chequeo, un admin podía reasignar una mesa activa a una cuenta que ya no podía ni siquiera autenticarse.

## Dónde más aparece `assignedStaffUserId`

- `open-table-session.service.ts`: al abrir una sesión, se setea automáticamente al `staffUserId` de quien la abre **solo si** `BranchSettings.tableAssignmentEnabled` es `true` para esa sucursal; si no, queda `null` (comportamiento histórico, sin cambios para sucursales que no activaron la función).
- `list-tables.service.ts`, `get-current-table-session.service.ts`, y `list-branch-ready-summary.service.ts` (módulo `orders`): las tres rutas de lectura que exponen `assignedStaffUserId` consultan `BranchSettings.tableAssignmentEnabled` y devuelven `null` en vez del valor real de la base si la sucursal tiene la función apagada. Esto se agregó después de la revisión: sin este chequeo, una sucursal que activó la función, acumuló asignaciones, y después la desactivó, seguía exponiendo asignaciones viejas por las rutas de lectura — la función no era realmente inerte al apagarla, solo dejaba de aceptar escrituras nuevas.

## Frontend

Ver doc 15 de `sazono-ui` (toggle en configuración de sucursal, UI del modal de mesa, corrección del selector de reasignación).

## Verificación

164 → 165 tests (`jest`), incluye 8 tests nuevos para `AssignTableSessionService` (autoasignación, reasignación por supervisor, rechazo de mesero reasignando a otro, rechazo de staff sin rol activo, rechazo de staff con cuenta desactivada, función apagada, sesión inexistente, sesión no activa). `tsc --noEmit` y `eslint` limpios.

Se corrió una revisión adversarial (3 dimensiones en paralelo — permisos de backend, correctitud de datos/migración, integración de frontend — cada hallazgo verificado de forma independiente antes de aceptarlo) que encontró y llevó a corregir: el chequeo de `StaffUser.status` arriba, la falta de gate en las 3 rutas de lectura, y el selector de reasignación del frontend (doc 15). Un cuarto hallazgo (el filtro "mis mesas" del frontend puede usar por una fracción de segundo la comparación vieja mientras carga la configuración de sucursal) quedó sin corregir a propósito: es de severidad baja, se autocorrige solo, y no filtra datos — arreglarlo bien implicaría bloquear el render de toda la pantalla por un caso raro.

## Backlog

Sigue pendiente el backlog #2 de doc 17: **"mesa virtual" para pedidos de mostrador/para llevar sin mesa física real** (patrón usado por la competencia, ej. Toteat). Bloqueado por una decisión de modelo de datos, no por esfuerzo de implementación: la regla activa hoy (doc 08) es que una mesa no puede tener más de una `TableSession` activa a la vez, y eso es incompatible tal cual con un mostrador que reciba varios pedidos para llevar en simultáneo. Antes de programar algo hay que elegir entre:

1. Relajar esa regla solo para mesas marcadas como virtuales (`Table.isVirtual` o similar) y crear una única mesa "Mostrador" por sucursal que admita N sesiones concurrentes.
2. Un pool de mesas virtuales reusables ("Para llevar 1", "Para llevar 2"...) sin tocar la regla existente.
3. Un modelo `CounterOrder` separado que no dependa de `Table` en absoluto — más limpio conceptualmente, pero duplica bastante de lo que ya hace `TableSession`/`Bill`.
