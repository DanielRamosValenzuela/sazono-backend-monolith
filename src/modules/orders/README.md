# Orders Module

Responsable de ordenes, items, origen QR o mesero y transiciones de estado.

## Estado actual

- orden pospago de mesero y prepago QR con snapshots de precio
- lectura staff y publica por QR
- `POST /api/v1/orders/:orderId/deliver`: marca orden `READY` como entregada
- `POST /api/v1/orders/:orderId/cancel`: cancela antes de produccion (staff operativo) o en produccion (supervisor/admin con reverso de cargos)

Los helpers `applyOrderChargeToBill` y `routeOrderToStations` se reutilizan desde `payments` al aprobar el prepago QR.
