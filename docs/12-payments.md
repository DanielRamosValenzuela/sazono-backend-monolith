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

Nota (2026-07-27): esta seccion describe el MVP original de un solo
adapter manual. Desde la integracion de Mercado Pago Chile (Checkout API,
marketplace no custodial via OAuth por restaurante) y despues Transbank
Webpay (conexion manual, redireccion), el cobro real pasa por
`ChargePaymentService`, que decide entre el registro manual
(`OFFLINE_PAYMENT_RECORDER`, canal `STAFF_OFFLINE`) y las pasarelas
conectadas del restaurante (`PAYMENT_GATEWAY_RESOLVER`, canal `QR_ONLINE`,
puede resolver mas de una a la vez). El detalle completo vive en doc 23
(`23-arquitectura-multi-proveedor-de-pago.md`, arquitectura general) y doc
21/doc 22 (especifico de cada proveedor); `src/modules/payments/README.md`
sigue siendo la referencia linea a linea de cada endpoint. El resto de esta
pagina (reglas de negocio de prepago QR, split, invariantes) sigue vigente.

## Proveedor de pago (MVP original, historico)

Diseño original antes de Mercado Pago: el cobro estaba aislado detras de un
unico puerto `PAYMENT_PROVIDER` con un solo adapter manual
(`ManualPaymentProviderAdapter`) que aprobaba de inmediato.

Ese puerto y ese adapter ya no existen en el codigo: fueron reemplazados por
`PAYMENT_GATEWAY_RESOLVER` (resuelve la cuenta Mercado Pago conectada del
restaurante, canal `QR_ONLINE`) y `OFFLINE_PAYMENT_RECORDER`
(`OfflinePaymentRecorderAdapter`, canal `STAFF_OFFLINE`), descritos en la
seccion anterior. Los casos de uso, las reglas de negocio y los contratos
HTTP no cambiaron con la migracion.

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

- reembolsos y anulaciones con impacto financiero en ordenes prepagadas
- application_fee de plataforma (reservado en el puerto, todavia sin activar)
- reconciliacion completa desde el webhook para el caso raro de un intento
  que quedo `PENDING` de una orden QR o un split participant (hoy el webhook
  finaliza el pago y el saldo de la cuenta, pero no re-ejecuta el ruteo a
  cocina ni la actualizacion del split; ver `src/modules/payments/README.md`)
- **split bill no ofrece Transbank de punta a punta**: `GET
  /qr/split-participants/:token` solo descubre una pasarela Mercado Pago
  conectada (bug de `GetBillSplitParticipantService`, hardcodea el
  proveedor), y el frontend (`split-payment.tsx`) tampoco tiene UI para
  redireccion. El endpoint de cobro (`.../pay/redirect`) si existe y
  funciona en el backend. Detalle completo, matriz de capacidad y el
  archivo/linea exacto en `src/modules/payments/README.md` (seccion
  "Transbank Webpay Plus Mall") y en `docs/24-pagos-vision-general.md`
