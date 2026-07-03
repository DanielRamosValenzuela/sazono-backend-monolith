# Billing and Manual Table Close

## Objetivo

Este slice conecta por primera vez `TableSession` con `Bill` y completa el flujo basico de cierre operativo del salon.

## Endpoints actuales

- `GET /api/v1/billing/table-sessions/:tableSessionId/current-bill`
- `POST /api/v1/floor/table-sessions/:tableSessionId/close`

## Reglas activas

- una `TableSession` nueva crea su `Bill` en el mismo flujo transaccional
- si existe una sesion activa legacy sin `Bill`, el backend la autocorrige al consultar billing o cerrar la mesa
- solo puede existir una `Bill` por `table_session_id`
- una mesa solo puede cerrarse si la cuenta actual no tiene saldo pendiente
- al cerrar la mesa, la `TableSession` pasa a `CLOSED`, la `Bill` se marca `PAID` y la mesa vuelve a `AVAILABLE`

## Permisos actuales

- consultar `Bill` actual: `ADMIN`, `SUPERVISOR`, `WAITER` o `CASHIER`
- cerrar mesa: `ADMIN`, `SUPERVISOR`, `WAITER` o `CASHIER`

## Lo que todavia no resuelve

- cobros reales y conciliacion con proveedor
- transicion a `PAYMENT_COMPLETED`
- split bill
- abandono o deuda pendiente
- advertencia por ordenes no entregadas al cerrar
