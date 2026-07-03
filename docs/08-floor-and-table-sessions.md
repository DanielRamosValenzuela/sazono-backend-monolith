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

## Reglas activas

- una mesa no puede tener mas de una `TableSession` activa
- para esta primera iteracion, se considera activa una sesion en `OPEN` o `PAYMENT_COMPLETED`
- abrir una sesion marca la mesa como `OCCUPIED`
- abrir una sesion crea automaticamente una `Bill` operativa asociada
- cerrar una sesion exige `Bill.remaining_amount = 0`
- cerrar una sesion marca la mesa como `AVAILABLE`
- no se puede abrir sesion sobre una mesa `DISABLED`

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
