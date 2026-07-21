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
- `GET /api/v1/orders/branch-ready-summary?branchId=<BRANCH_ID>` — registrado antes de `GET /orders/:orderId` en el controller para no chocar con la ruta parametrizada
- `GET /api/v1/orders/:orderId`
- `POST /api/v1/orders/:orderId/deliver`
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
- cada item puede llevar `modifierOptionIds?: string[]` (`CreateOrderItemDto`, opcional); `orderable-menu-item-resolver.service.ts` valida la seleccion contra cada grupo de modificadores adjunto al item (`minSelect`/`maxSelect`/`isRequired`) y suma el `priceDelta` de cada opcion seleccionada al precio base. Sin `modifierOptionIds` el `priceSnapshot` es identico al de antes (verificado con test de no-regresion)
- se crean filas `OrderItemModifier` (snapshot de `name`/`priceDelta`) en la misma transaccion que crea el `OrderItem`; `OrderItemResponseDto` expone `modifiers: OrderItemModifierResponseDto[]`
- en la misma transaccion: se crean los `bill_items`, se recalculan totales de la `Bill` y se generan los `station_tickets` agrupados por estacion
- la orden nace `ROUTED`

### Orden QR (prepago)

- el endpoint es publico y se resuelve por `qrToken` de la mesa
- la sucursal debe tener `qrOrderingEnabled`
- si la mesa no tiene sesion activa, el pedido abre la `TableSession` (origen `QR`) y su `Bill`
- la orden nace `AWAITING_PAYMENT`: no genera cargos en la cuenta ni tickets hasta que payments apruebe el pago
- el cliente puede consultar sus ordenes de la sesion activa con el mismo `qrToken`
- tambien soporta `modifierOptionIds` por item, con la misma validacion y snapshot que la orden de mesero (mismo `orderable-menu-item-resolver.service.ts`); `create-qr-order.service.ts` crea los `order_items` con un loop de `orderItem.create` individuales (antes `createMany`), necesario para poder anidar la creacion de sus modificadores por item

### Tickets de estacion

- transiciones validas: `PENDING -> IN_PROGRESS|CANCELLED`, `IN_PROGRESS -> READY|CANCELLED` (`StationTicketStatus` ya no tiene `ACCEPTED`, ver doc 17)
- cancelar un ticket requiere rol `ADMIN` o `SUPERVISOR`
- al avanzar un ticket se sincronizan los `station_ticket_items` y los `order_items`
- el estado comercial de la orden se recalcula desde sus tickets: todos listos -> `READY`, algunos listos -> `PARTIALLY_READY`, alguno en progreso -> `IN_PREPARATION`

### Entrega y notificacion de "listo"

- `POST /orders/:orderId/deliver` — marca la orden como `DELIVERED`. Roles permitidos: `ADMIN`, `SUPERVISOR`, `CASHIER`, `WAITER`, `KITCHEN` (`deliver-order.service.ts`; `WAITER`/`KITCHEN` se agregaron en la ronda de doc 17, antes solo administracion/caja podian marcar entrega)
- `GET /orders/branch-ready-summary?branchId=` — por cada `TableSession` activa de la sucursal devuelve `{ tableSessionId, tableId, tableCode, openedByStaffUserId, readyUndeliveredCount }` (cantidad de ordenes en `READY` sin entregar), en una sola query agregada. Roles: `ADMIN`, `SUPERVISOR`, `WAITER`, `CASHIER`, `KITCHEN`, `BAR`. `openedByStaffUserId` es un campo de `TableSession` que ya existia en el schema pero no se exponia en ningun DTO de respuesta; este endpoint es el primero en exponerlo (el frontend lo usa para el filtro "mis mesas")
- el mismo `list-branch-ready-summary.service.ts` aplica "auto-entrega perezosa": si `BranchSettings.autoDeliverAfterMinutes` esta configurado (nullable, por defecto requiere confirmacion manual), cualquier orden `READY` cuyo tiempo desde que su ultimo `StationTicket` se completo supere ese umbral se transiciona a `DELIVERED` (orden + items no cancelados) en una transaccion, antes de devolver la respuesta. No hay `@nestjs/schedule` instalado — es expiracion perezosa al leer, no un cron job

## Impuestos

La politica tributaria del MVP vive aislada en `src/modules/billing/domain/tax-policy.ts`:

- los precios de carta ya incluyen el impuesto local (IVA en Chile)
- `taxAmount` queda en 0 como campo informativo
- una futura expansion a paises con otra regla se resuelve en ese archivo, sin tocar los casos de uso

## Consumo frontend

`sazono-ui` ya tiene UI real para ambos endpoints staff: pedido de mesero
(`widgets/floor-console/ui/add-order-sheet.tsx`, `POST /orders`) y tablero de
cocina/barra (`widgets/kitchen-board`, ruta `/staff/kitchen`, consume listado
y avance de tickets). Ver doc frontend 06 para el detalle. Cambios de forma
en `OrderResponseDto`/`StationTicketResponseDto` ahora rompen una pantalla
real, no solo contratos documentados.

## Lo que falta despues

- edicion de ordenes antes de produccion (solo cancelacion implementada por ahora)
