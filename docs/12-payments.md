# Payments

## Objetivo

Este slice cierra el ciclo comercial de la mesa:

- prepago de ordenes QR con reintento ante fallo
- pago total o parcial de la cuenta abierta desde QR
- registro de pagos por caja, supervisor o admin
- propina opcional en todos los flujos
- sesion `PAYMENT_COMPLETED` al saldar la cuenta, sin cierre automatico de mesa

## Endpoints publicos QR

- `POST /api/v1/qr/tables/:qrToken/orders/:orderId/pay`
- `POST /api/v1/qr/tables/:qrToken/bill/payments`

## Endpoints staff

- `POST /api/v1/payments/bills/:billId` (roles `ADMIN`, `SUPERVISOR`, `CASHIER`)
- `GET /api/v1/payments/bills/:billId` (ademas `WAITER`, para consultar)
- `POST /api/v1/payments/bills/:billId/splits`
- `GET /api/v1/payments/bills/:billId/splits/current`

## Endpoints publicos QR (pagos)

- `POST /api/v1/qr/tables/:qrToken/orders/:orderId/pay`
- `POST /api/v1/qr/tables/:qrToken/bill/payments`
- `POST /api/v1/qr/tables/:qrToken/bill/splits`
- `GET /api/v1/qr/tables/:qrToken/bill/splits/current`
- `POST /api/v1/qr/split-participants/:participantToken/pay`

## Proveedor de pago

El cobro esta aislado detras del puerto `PAYMENT_PROVIDER`
(`src/modules/payments/application/ports/payment-provider.port.ts`).

El MVP usa `ManualPaymentProviderAdapter`: aprueba el cobro de inmediato y
representa el pago validado en el punto de venta o un provider simulado.

Integrar una pasarela real (Webpay/Transbank, MercadoPago, Stripe, etc.)
significa escribir un nuevo adapter de ese puerto. Los casos de uso, las
reglas y los contratos HTTP no cambian.

## Reglas activas

### Prepago de orden QR

- la orden debe estar `AWAITING_PAYMENT` o `PAYMENT_FAILED` y pertenecer a la mesa del `qrToken`
- se crea un `payment_attempt` por cada intento de cobro
- si el proveedor rechaza: attempt `FAILED` con motivo, orden `PAYMENT_FAILED`, y el cliente reintenta con el mismo endpoint sin perder el pedido
- si aprueba, en una sola transaccion: attempt `SUCCEEDED`, se crea el `payment`, se cargan los items a la `Bill`, se asienta el pago y se generan los tickets por estacion; la orden pasa a `ROUTED`
- doble pago protegido: dentro de la transaccion se revalida el estado de la orden

### Pago de cuenta abierta

- la cuenta debe estar `OPEN` o `PARTIALLY_PAID`
- el monto debe ser mayor a cero y no superar el saldo pendiente
- la propina se suma al total de la cuenta y se paga en el mismo movimiento
- pagos parciales dejan la cuenta `PARTIALLY_PAID`
- al saldar la cuenta queda `PAID` y la sesion pasa a `PAYMENT_COMPLETED`

### Split bill simple

- requiere `splitBillEnabled` en la sucursal
- solo un split activo por cuenta
- modo `BY_AMOUNT`: las partes deben sumar exactamente el saldo pendiente
- cada participante recibe un `participantToken` para pagar su parte desde QR
- ver doc 13 para entrega, cancelacion y abandono

### Invariantes protegidas

- la mesa nunca se cierra automaticamente: `PAYMENT_COMPLETED` sigue siendo una sesion activa y el cierre es manual (`floor`)
- un cargo nuevo sobre una sesion ya pagada la devuelve a `OPEN`
- QR no entra a produccion sin pago aprobado

## Lo que falta despues

- adapter de pasarela real con webhooks de confirmacion asincrona
- reembolsos y anulaciones con impacto financiero en ordenes prepagadas
