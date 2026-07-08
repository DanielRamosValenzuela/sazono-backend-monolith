# Payments Module

Responsable de intentos de pago, confirmacion de pagos, split bill y conciliacion basica.

## Estado actual

- `POST /api/v1/qr/tables/:qrToken/orders/:orderId/pay`: prepago QR con reintento
- `POST /api/v1/qr/tables/:qrToken/bill/payments`: pago total o parcial de cuenta desde QR
- `POST /api/v1/payments/bills/:billId`: pago registrado por caja, supervisor o admin
- `GET /api/v1/payments/bills/:billId`: lista pagos de una cuenta
- `POST /api/v1/payments/bills/:billId/splits` y `POST /api/v1/qr/tables/:qrToken/bill/splits`: split `BY_AMOUNT` del saldo pendiente
- `GET .../splits/current`: consulta del split activo
- `GET /api/v1/qr/split-participants/:participantToken`: detalle de un participante (cuanto debe, cuanto pago), sin autenticacion
- `POST /api/v1/qr/split-participants/:participantToken/pay`: pago de la parte de un participante

El cobro esta aislado tras el puerto `PAYMENT_PROVIDER`. El MVP usa
`ManualPaymentProviderAdapter` (aprueba de inmediato). Una pasarela real se
integra escribiendo un nuevo adapter, sin tocar los casos de uso.
