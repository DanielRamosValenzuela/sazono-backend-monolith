# Orders Module

Responsable de ordenes, items, origen QR o mesero y transiciones de estado.

## Estado actual

- `POST /api/v1/orders`: orden pospago de mesero; snapshotea nombre y precio, carga la `Bill` y genera tickets por estacion en una sola transaccion
- `POST /api/v1/qr/tables/:qrToken/orders`: orden prepago QR; abre la sesion si no existe y queda en `AWAITING_PAYMENT` sin cargos ni tickets
- `GET /api/v1/orders?tableSessionId=` y `GET /api/v1/orders/:orderId`: lectura staff
- `GET /api/v1/qr/tables/:qrToken/orders`: lectura publica de las ordenes de la sesion activa

Los helpers `applyOrderChargeToBill` y `routeOrderToStations` estan pensados para reutilizarse desde `payments` cuando se apruebe el pago de una orden QR.
