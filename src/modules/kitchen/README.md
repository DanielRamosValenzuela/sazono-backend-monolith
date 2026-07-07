# Kitchen Module

Responsable de estaciones, tickets de cocina/barra y avance operacional.

## Estado actual

- `GET /api/v1/kitchen/station-tickets`: lista tickets por sucursal, filtrables por estacion y estado
- `POST /api/v1/kitchen/station-tickets/:stationTicketId/status`: avanza el ticket validando transiciones (`PENDING -> ACCEPTED|IN_PROGRESS`, `IN_PROGRESS -> READY`, cancelacion solo para `ADMIN`/`SUPERVISOR`)

Al avanzar un ticket se sincronizan los estados de `station_ticket_items` y `order_items`, y se recalcula el estado comercial de la orden (`IN_PREPARATION`, `PARTIALLY_READY`, `READY`) a partir de todos sus tickets.
