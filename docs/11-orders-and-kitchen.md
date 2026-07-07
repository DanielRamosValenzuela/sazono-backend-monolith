# Orders and Kitchen

## Objetivo

Este slice conecta la carta publicada con la operacion real de la mesa:

- ordenes pospago de mesero que entran directo a produccion
- ordenes prepago QR que esperan aprobacion de pago
- lectura publica de carta y ordenes por `qrToken`
- tickets por estacion para cocina y barra
- avance de estados de produccion con sincronizacion de orden e items

## Endpoints staff

- `POST /api/v1/orders`
- `GET /api/v1/orders?tableSessionId=<TABLE_SESSION_ID>`
- `GET /api/v1/orders/:orderId`
- `GET /api/v1/kitchen/station-tickets?branchId=<BRANCH_ID>`
- `POST /api/v1/kitchen/station-tickets/:stationTicketId/status`

## Endpoints publicos QR

- `GET /api/v1/qr/tables/:qrToken/menu`
- `POST /api/v1/qr/tables/:qrToken/orders`
- `GET /api/v1/qr/tables/:qrToken/orders`

## Reglas activas

### Orden de mesero (pospago)

- requiere sesion de mesa activa
- los items deben pertenecer a la carta publicada de la sucursal, con categoria activa, item disponible y estacion activa
- se snapshotea nombre y precio del item al momento de ordenar
- en la misma transaccion: se crean los `bill_items`, se recalculan totales de la `Bill` y se generan los `station_tickets` agrupados por estacion
- la orden nace `ROUTED`

### Orden QR (prepago)

- el endpoint es publico y se resuelve por `qrToken` de la mesa
- la sucursal debe tener `qrOrderingEnabled`
- si la mesa no tiene sesion activa, el pedido abre la `TableSession` (origen `QR`) y su `Bill`
- la orden nace `AWAITING_PAYMENT`: no genera cargos en la cuenta ni tickets hasta que payments apruebe el pago
- el cliente puede consultar sus ordenes de la sesion activa con el mismo `qrToken`

### Tickets de estacion

- transiciones validas: `PENDING -> ACCEPTED|IN_PROGRESS|CANCELLED`, `ACCEPTED -> IN_PROGRESS|CANCELLED`, `IN_PROGRESS -> READY|CANCELLED`
- cancelar un ticket requiere rol `ADMIN` o `SUPERVISOR`
- al avanzar un ticket se sincronizan los `station_ticket_items` y los `order_items`
- el estado comercial de la orden se recalcula desde sus tickets: todos listos -> `READY`, algunos listos -> `PARTIALLY_READY`, alguno en progreso -> `IN_PREPARATION`

## Impuestos

La politica tributaria del MVP vive aislada en `src/modules/billing/domain/tax-policy.ts`:

- los precios de carta ya incluyen el impuesto local (IVA en Chile)
- `taxAmount` queda en 0 como campo informativo
- una futura expansion a paises con otra regla se resuelve en ese archivo, sin tocar los casos de uso

## Lo que falta despues

- payments: aprobar pago QR y ejecutar cargo + ruteo de la orden prepago
- pago de cuenta abierta y split bill
- entrega (`DELIVERED`) y edicion o cancelacion de ordenes antes de produccion
- resolucion de abandono y deuda por supervisor o caja
