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
- `GET /api/v1/qr/tables/:qrToken/payment-config`: indica si el restaurante
  tiene una pasarela conectada y expone su `publicKey`, sin autenticacion
- `GET /api/v1/qr/tables/:qrToken/orders/:orderId/payment-status`: estado del
  ultimo intento de pago de una orden QR, para que el frontend haga polling
  tras un `pay` cuyo request se corto en el navegador; sin autenticacion
- `POST /api/v1/webhooks/payments/mercado-pago`: recibe notificaciones de
  Mercado Pago, sin autenticacion, protegido por verificacion de firma HMAC

El cobro pasa siempre por `ChargePaymentService`, que decide la ruta segun el
`PaymentChannel` (`STAFF_OFFLINE` o `QR_ONLINE`) de cada caso de uso:

- `STAFF_OFFLINE` (caja/supervisor/admin cobrando dinero que el restaurante ya
  recibio con su propio datafono o efectivo) registra el pago directo contra
  el puerto `OFFLINE_PAYMENT_RECORDER` y nunca consulta ninguna pasarela real.
- `QR_ONLINE` (pago publico desde el QR del cliente) primero resuelve la
  cuenta conectada del restaurante via el puerto `PAYMENT_GATEWAY_RESOLVER`.
  Solo cobra de verdad si ademas viene un `checkout` (cardToken +
  paymentMethodId + installments) en el mismo request; si falta cualquiera de
  los dos, cae al mismo registro offline salvo que
  `PAYMENTS_QR_GATEWAY_REQUIRED=true`, en cuyo caso se rechaza en vez de
  aprobar sin cobro real.

`PAYMENT_GATEWAY_RESOLVER` esta implementado por
`PaymentGatewayResolverService`, que busca la `RestaurantPaymentAccount`
`CONNECTED` del restaurante y arma un `MercadoPagoGatewayAdapter` con el
access token descifrado de ESE restaurante (nunca uno global de Sazono).
`OFFLINE_PAYMENT_RECORDER` sigue siendo `OfflinePaymentRecorderAdapter`
(aprueba de inmediato).

El adapter de Mercado Pago (`infrastructure/mercado-pago/mercado-pago-gateway.adapter.ts`)
usa `binary_mode: true` (la API nunca devuelve `pending`) y, como respaldo
defensivo, si igual llegara un pago `pending`/`in_process` lo cancela y lo
trata como rechazado con log `WARN` para conciliacion manual. El
`application_fee` esta reservado en el puerto pero nunca se envia todavia
(queda para cuando Sazono cobre comision).

## Webhook de Mercado Pago (Fase 3)

`PaymentWebhooksController` expone `POST /api/v1/webhooks/payments/mercado-pago`,
publico y con `@SkipThrottle()` (la ruta ya esta protegida por HMAC, no por el
throttling global; ver razonamiento abajo). El flujo:

1. `MercadoPagoSignatureVerifier` recalcula el manifest exacto de la doc oficial
   (`id:<data.id de query params, minusculas si es alfanumerico>;request-id:<header x-request-id>;ts:<header ts>;`,
   quitando cualquier segmento cuyo valor no venga en la notificacion), firma
   con HMAC-SHA256 usando `MERCADOPAGO_WEBHOOK_SECRET` y compara con
   `timingSafeEqual` contra el `v1` del header `x-signature`. Tambien aplica
   una ventana anti-replay de `MERCADOPAGO_WEBHOOK_TOLERANCE_SECONDS`
   (default 300s) sobre el `ts`, normalizando si viene en milisegundos.
   Doc oficial: `MERCADO_PAGO_WEBHOOK_SIGNATURE_DOCS_URL` en
   `mercado-pago-signature.verifier.ts`.
2. Firma invalida -> `401` inmediato, `HandleMercadoPagoWebhookService` nunca
   se invoca y no se escribe nada en `PaymentWebhookEvent` (evita que un
   request no autenticado envenene la tabla de idempotencia con un `eventId`
   elegido por el atacante).
3. Firma valida -> `HandleMercadoPagoWebhookService.execute()`:
   - Idempotencia dura por `PaymentWebhookEvent.eventId` = `id` del **body**
     de la notificacion (no `x-request-id`, que no esta garantizado estable
     entre reintentos). Un `eventId` repetido corta antes de tocar cualquier
     otra tabla o red.
   - Tipos distintos de `payment` (`merchant_order`, `mp-connect`, etc.) se
     registran y marcan procesados sin mas trabajo.
   - Correlacion: primero `PaymentAttempt` por `(provider, providerReference)`
     (usa el `data.id` de la notificacion, indice ya existente desde la Fase 1).
     Si no hay match, resuelve la `RestaurantPaymentAccount` por
     `externalAccountId` = `user_id` del body, arma el gateway de ESE
     restaurante via `PAYMENT_GATEWAY_RESOLVER` y usa
     `getPayment().externalReference` (el `attemptId` original enviado como
     `external_reference` al cobrar) para encontrar el `PaymentAttempt`.
   - **Siempre** reconsulta `gateway.getPayment(dataId)` antes de decidir (si
     el fallback anterior ya tuvo que llamarlo, reusa esa respuesta en vez de
     pedirla dos veces); la notificacion en si nunca trae el estado del pago
     para el topico `payment`, solo dispara la consulta.
   - `approved` -> `FinalizePaymentService` + `applyPaymentToBill` en una
     transaccion, pero solo si el `PaymentAttempt` seguia `PENDING` (con
     `binary_mode: true` esto deberia ser rarisimo: solo pasa si el proceso
     se cayo entre el `charge()` sincrono y el `finalize` de la Fase 2).
   - `rejected`/`cancelled` -> `FailPaymentService`, y si el intento venia de
     una orden QR (`orderId` presente) tambien marca la orden
     `PAYMENT_FAILED`.
   - `in_process`/`pending` -> no-op, solo actualiza
     `PaymentAttempt.providerStatus/providerStatusDetail` para trazabilidad.
   - Si el `PaymentAttempt` ya estaba en un estado terminal (caso normal:
     `binary_mode` ya resolvio todo de forma sincrona), el webhook solo
     actualiza `providerStatus/providerStatusDetail` para auditoria, nunca
     vuelve a llamar `FinalizePaymentService`/`FailPaymentService` sobre un
     intento ya resuelto.
   - Cualquier error atrapado se guarda en
     `PaymentWebhookEvent.processError` y el evento igual queda marcado
     `processedAt`; la respuesta HTTP sigue siendo `200` (reintentar la misma
     notificacion no ayuda si el fallo es de correlacion, y Mercado Pago
     reintenta cada 15 min indefinidamente si no responde 200/201).
4. `ChargePaymentService` ahora envia `notificationUrl` (=
   `MERCADOPAGO_WEBHOOK_URL`) en cada `charge()` real, para que Mercado Pago
   tenga tambien la URL especifica del pago ademas de la configurada en el
   panel de la app.

**Limitacion conocida (documentada, no resuelta en esta fase):** si el
webhook sí llega a reconciliar un intento que seguía `PENDING` (el caso raro
de crash-recovery), hoy solo se ejecuta `FinalizePaymentService` +
`applyPaymentToBill` (con `tipDelta = 0`, porque el reparto original
tip/monto no se puede reconstruir de forma confiable solo desde el
`PaymentAttempt`). Los efectos adicionales de cada flujo original — ruteo a
cocina (`pay-qr-order`) o actualizacion del split (`pay-bill-split-participant`)
— **no** se re-ejecutan automaticamente; queda para revision manual (ver
`PaymentWebhookEvent.process_error` y el log `WARN` que deja el servicio).

`GET /api/v1/qr/tables/:qrToken/orders/:orderId/payment-status` expone el
estado del ultimo `PaymentAttempt` de una orden (y el `Payment` vinculado si
ya existe) para que el frontend haga polling despues de un `pay` cuyo
`fetch` se corto en el navegador, sin tener que reintentar el cobro.
