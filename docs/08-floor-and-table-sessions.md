# Floor and Table Sessions

## Objetivo

El modulo `floor` cubre la operacion basica del salon:

- mesas
- apertura manual de `TableSession`
- retoma de la sesion activa de una mesa
- cierre manual de una mesa operativa

## Endpoints actuales

- `POST /api/v1/floor/tables`
- `GET /api/v1/floor/tables`
- `POST /api/v1/floor/table-sessions/open`
- `GET /api/v1/floor/tables/:tableId/current-session`
- `POST /api/v1/floor/table-sessions/:tableSessionId/close`
- `POST /api/v1/floor/table-sessions/:tableSessionId/assign` (ver "Asignacion formal" mas abajo)
- `POST /api/v1/floor/counter-sessions`, `GET /api/v1/floor/counter-sessions?branchId=&mine=`, `PATCH /api/v1/floor/counter-sessions/:tableSessionId` (pedidos de mesa virtual, ver doc 26)

## Reglas activas

- una mesa no puede tener mas de una `TableSession` activa. **Excepcion**: las sesiones de mesa virtual (`TableSession.isCounter = true`) viven sobre la unica mesa virtual de la sucursal (`Table.isVirtual`) y pueden ser muchas en simultaneo; el indice unico parcial solo aplica a `is_counter = false` y el numero de ticket es unico entre las activas de la sucursal. La mesa virtual no aparece en el salon ni se abre por los flujos normales. Detalle en doc 26
- para esta primera iteracion, se considera activa una sesion en `OPEN` o `PAYMENT_COMPLETED`
- abrir una sesion marca la mesa como `OCCUPIED`
- abrir una sesion crea automaticamente una `Bill` operativa asociada
- cerrar una sesion exige `Bill.remaining_amount = 0`; en mesa virtual exige ademas todas las ordenes no canceladas `DELIVERED` (`409` si no)
- cerrar una sesion marca la mesa como `AVAILABLE` (no en mesa virtual: la mesa virtual no cambia de estado)
- `open-table-session`, `get-current-session` y `set-zone` sobre la mesa virtual, y `assign-table-session` sobre una sesion de mesa virtual, responden `400`
- no se puede abrir sesion sobre una mesa `DISABLED`

## Asignacion formal (opcional, ver doc 18)

`TableSession` tiene un campo `assignedStaffUserId`, separado de `openedByStaffUserId` (que sigue siendo inmutable). Solo se usa si `BranchSettings.tableAssignmentEnabled` esta en `true` para la sucursal — apagado por defecto, no cambia nada para una sucursal que no lo active. Con la funcion activada: al abrir una sesion se autoasigna a quien la abre; `WAITER`/`CASHIER` solo pueden reasignarse la mesa a si mismos; `ADMIN`/`SUPERVISOR` pueden reasignarla a cualquier staff con rol operativo activo en la sucursal. Detalle completo (schema, migracion, permisos, revision) en doc 18.

## Comensales y zonas de mesa (ver doc 20)

Desde doc 20: abrir una `TableSession` por mesero o cajero (`POST /floor/table-sessions/open`) ahora exige `guestCount` (entero 1 a 30) en el body. Las sesiones abiertas por QR no pasan por este endpoint y quedan sin ese dato.

Endpoints nuevos, todos bajo `/api/v1/floor`, mismo guard que el resto del modulo:

- `GET /zones?branchId=` - lista zonas de una sucursal (roles: `ADMIN`, `SUPERVISOR`, `WAITER`, `CASHIER`, `KITCHEN`)
- `POST /zones` - crea zona (`ADMIN`, `SUPERVISOR`)
- `PATCH /zones/:zoneId` - renombra zona (`ADMIN`, `SUPERVISOR`)
- `DELETE /zones/:zoneId` - elimina zona (`ADMIN`, `SUPERVISOR`)
- `PATCH /tables/:tableId/zone` - asigna/quita zona de una mesa (`ADMIN`, `SUPERVISOR`)
- `PUT /zones/:zoneId/staff` - reemplaza el equipo de una zona (`ADMIN`, `SUPERVISOR`)
- `GET /branch-staff?branchId=` - lista personal de la sucursal para poblar selectores (`ADMIN`, `SUPERVISOR` unicamente)

Ademas, la regla "una mesa solo puede tener una `TableSession` activa" (salvo la mesa virtual) ahora tiene respaldo de un indice unico parcial a nivel de base de datos (antes solo era un chequeo de aplicacion con una condicion de carrera real entre dos aperturas simultaneas). Detalle completo en doc 20.

## Permisos actuales

- crear mesas: `ADMIN` o `SUPERVISOR`
- listar mesas y retomar sesion: `ADMIN`, `SUPERVISOR`, `WAITER` o `CASHIER`
- abrir sesion:
  - `WAITER` puede abrir con origen `WAITER`
  - `CASHIER` puede abrir con origen `CASHIER`
  - `ADMIN` y `SUPERVISOR` pueden operar ambos origenes internos
- cerrar sesion manualmente: `ADMIN`, `SUPERVISOR`, `WAITER` o `CASHIER`
- sesiones de mesa virtual (`/floor/counter-sessions`): `ADMIN`, `SUPERVISOR`, `WAITER`, `CASHIER`, no `KITCHEN`; `WAITER` tambien puede cobrar, cerrar y abandonar solo sesiones de mesa virtual (doc 26)

## Alcance actual

Este slice deja listo:

- catalogo inicial de mesas por sucursal
- apertura manual de mesa
- consulta de la sesion activa para retomar operacion
- cierre manual seguro cuando la cuenta ya no tiene saldo pendiente
- integracion inicial con `Bill`

## Lo que falta despues

- advertencia por ordenes aun no entregadas antes del cierre en mesas normales (en mesa virtual ya es un `409` duro)
- transicion explicita a `PAYMENT_COMPLETED` desde `payments`
- apertura QR
