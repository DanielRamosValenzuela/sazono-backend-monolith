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

## Reglas activas

- una mesa no puede tener mas de una `TableSession` activa
- para esta primera iteracion, se considera activa una sesion en `OPEN` o `PAYMENT_COMPLETED`
- abrir una sesion marca la mesa como `OCCUPIED`
- abrir una sesion crea automaticamente una `Bill` operativa asociada
- cerrar una sesion exige `Bill.remaining_amount = 0`
- cerrar una sesion marca la mesa como `AVAILABLE`
- no se puede abrir sesion sobre una mesa `DISABLED`

## Asignacion formal (opcional, ver doc 18)

`TableSession` tiene un campo `assignedStaffUserId`, separado de `openedByStaffUserId` (que sigue siendo inmutable). Solo se usa si `BranchSettings.tableAssignmentEnabled` esta en `true` para la sucursal — apagado por defecto, no cambia nada para una sucursal que no lo active. Con la funcion activada: al abrir una sesion se autoasigna a quien la abre; `WAITER`/`CASHIER` solo pueden reasignarse la mesa a si mismos; `ADMIN`/`SUPERVISOR` pueden reasignarla a cualquier staff con rol operativo activo en la sucursal. Detalle completo (schema, migracion, permisos, revision) en doc 18.

## Permisos actuales

- crear mesas: `ADMIN` o `SUPERVISOR`
- listar mesas y retomar sesion: `ADMIN`, `SUPERVISOR`, `WAITER` o `CASHIER`
- abrir sesion:
  - `WAITER` puede abrir con origen `WAITER`
  - `CASHIER` puede abrir con origen `CASHIER`
  - `ADMIN` y `SUPERVISOR` pueden operar ambos origenes internos
- cerrar sesion manualmente: `ADMIN`, `SUPERVISOR`, `WAITER` o `CASHIER`

## Alcance actual

Este slice deja listo:

- catalogo inicial de mesas por sucursal
- apertura manual de mesa
- consulta de la sesion activa para retomar operacion
- cierre manual seguro cuando la cuenta ya no tiene saldo pendiente
- integracion inicial con `Bill`

## Lo que falta despues

- advertencia por ordenes aun no entregadas antes del cierre
- transicion explicita a `PAYMENT_COMPLETED` desde `payments`
- apertura QR
