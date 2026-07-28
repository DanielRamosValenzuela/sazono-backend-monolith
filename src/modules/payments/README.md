# Payments Module

Responsable de intentos de pago, confirmacion de pagos, split bill y conciliacion basica.

## Estado actual

- `POST /api/v1/qr/tables/:qrToken/orders/:orderId/pay`: prepago QR con reintento (checkout embebido, ej. Mercado Pago)
- `POST /api/v1/qr/tables/:qrToken/orders/:orderId/pay/redirect`: inicia el mismo prepago con una pasarela de redireccion (ej. Transbank Webpay); devuelve `{ redirectUrl, method, fields }` para el form-POST del frontend. Sin autenticacion
- `POST /api/v1/qr/tables/:qrToken/bill/payments`: pago total o parcial de cuenta desde QR (checkout embebido)
- `POST /api/v1/qr/tables/:qrToken/bill/payments/redirect`: inicia el mismo pago de cuenta con una pasarela de redireccion. Sin autenticacion
- `POST /api/v1/payments/bills/:billId`: pago registrado por caja, supervisor o admin
- `GET /api/v1/payments/bills/:billId`: lista pagos de una cuenta
- `POST /api/v1/payments/bills/:billId/splits` y `POST /api/v1/qr/tables/:qrToken/bill/splits`: split `BY_AMOUNT` del saldo pendiente
- `GET .../splits/current`: consulta del split activo
- `GET /api/v1/qr/split-participants/:participantToken`: detalle de un participante (cuanto debe, cuanto pago), sin autenticacion
- `POST /api/v1/qr/split-participants/:participantToken/pay`: pago de la parte de un participante (checkout embebido)
- `POST /api/v1/qr/split-participants/:participantToken/pay/redirect`: inicia el mismo pago de participante con una pasarela de redireccion. Sin autenticacion
- `GET /api/v1/qr/tables/:qrToken/payment-config`: retorna `{ options: [...] }`
  con las pasarelas conectadas del restaurante (provider, checkoutMode,
  publicKey si aplica, environment, isPreferred), ordenadas por
  `displayPriority`, sin autenticacion
- `PATCH /api/v1/payment-accounts/:provider/pause` y `.../resume`: pausan o
  reanudan una cuenta sin tocar sus credenciales (`CONNECTED` <-> `PAUSED`).
  Requiere rol ADMIN
- `PATCH /api/v1/payment-accounts/:provider/preferred`: sube el
  `displayPriority` de esa cuenta por encima de las demas del mismo
  restaurante. Requiere rol ADMIN
- `GET /api/v1/qr/tables/:qrToken/orders/:orderId/payment-status`: estado del
  ultimo intento de pago de una orden QR, para que el frontend haga polling
  tras un `pay` cuyo request se corto en el navegador; sin autenticacion
- `POST /api/v1/webhooks/payments/mercado-pago`: recibe notificaciones de
  Mercado Pago, sin autenticacion, protegido por verificacion de firma HMAC
- `POST /api/v1/payment-accounts/transbank`, `GET .../transbank`,
  `DELETE .../transbank`: conexion MANUAL (sin OAuth, Transbank no lo ofrece)
  de la cuenta Webpay Mall del restaurante con su `childCommerceCode`. Requiere
  rol ADMIN para conectar/desconectar
- `POST /api/v1/payment-accounts/transbank/return`: endpoint publico, sin
  guards, al que Transbank redirige (via POST del navegador del cliente)
  tras el pago; confirma o falla el `PaymentAttempt` asociado

## Transbank Webpay Plus Mall (Fase 2)

Segundo proveedor registrado en el mismo `PaymentGatewayRegistry` de la Fase 1
(`infrastructure/transbank/webpay-mall-gateway.adapter.ts`,
`checkoutMode: 'redirect'`). No reemplaza a Mercado Pago: ambos pueden estar
`CONNECTED` para el mismo restaurante a la vez, y `PaymentGatewayResolverService`
elige el de mayor `displayPriority` para cobrar.

- **Conexion**: manual, no OAuth. Un ADMIN llama
  `POST /payment-accounts/transbank` con `{ childCommerceCode, environment? }`
  (el `childCommerceCode` es el codigo de tienda hija que Transbank asigna a
  ESE restaurante dentro del Mall de Sazono; `environment` por defecto usa
  `TRANSBANK_ENVIRONMENT`). No hay secretos por restaurante que cifrar: la
  unica credencial secreta (`TRANSBANK_API_KEY`) es de PLATAFORMA, vive en el
  `.env` del backend, nunca en la base de datos.
- **Credenciales por llamada**: igual que Mercado Pago, el adapter es un
  provider de Nest singleton sin estado. `TransbankConfigService` inyecta
  `mallCommerceCode`/`apiKey`/`environmentUrl`/`timeoutMs` (de plataforma) en
  cada `new WebpayPlus.MallTransaction(new Options(...))`; el
  `childCommerceCode` de cada restaurante viaja en
  `GatewayChargeContext.credentials.childCommerceCode`, resuelto por
  `PaymentGatewayResolverService.resolveCredentials` (nuevo caso
  `TRANSBANK` en el switch exhaustivo).
- **`charge()`**: deriva un `buyOrder` deterministico (`domain/transbank-buy-order.ts`,
  `sz-` + 23 caracteres hex de `sha256(attemptId)`, siempre 26 caracteres —
  el maximo que acepta Transbank) porque el `attemptId` interno es un UUID de
  36 caracteres y no cabe tal cual. Llama `create(buyOrder, buyOrder, TRANSBANK_RETURN_URL, [TransactionDetail])`
  con el monto validado como entero CLP (`infrastructure/transbank/transbank-amount.ts`)
  y devuelve `{ kind: 'REDIRECT', providerReference: token, redirectUrl: url,
  method: 'POST', fields: { token_ws: token }, expiresAt }`. El
  `providerReference` (el `token` de Transbank) es lo unico que permite
  correlacionar despues con el `PaymentAttempt`, ya que el `buyOrder` no es
  reversible al `attemptId` original.
- **`confirmRedirect(token)`**: llama `commit(token)` y mapea el resultado
  (`domain/transbank-status.ts`) a `APPROVED` solo si
  `details[0].status === 'AUTHORIZED' && details[0].response_code === 0`;
  cualquier otro caso (`FAILED`, `NULLIFIED`, etc.) es `REJECTED`.
  `getPayment(token)` usa `status(token)`, misma forma de respuesta.
- **El checkout embebido y el redirect son dos familias de endpoints
  separadas, a proposito**: `ChargePaymentService.execute()` (usado por
  `pay-qr-order`, `pay-qr-bill`/`pay-bill` y `pay-bill-split-participant`)
  solo invoca a un gateway conectado cuando el request trae `checkout`
  (cardToken + paymentMethodId + installments), un concepto que NO aplica a
  Webpay (el cliente nunca entrega datos de tarjeta a Sazono; Transbank cobra
  en su propia pagina). Si la pasarela resuelta para esos 3 endpoints resulta
  ser `checkoutMode: 'redirect'`, `require-settled-charge.ts` rechaza con
  `ConflictException` en vez de intentar cobrar. **Esto ya no es un gap**: el
  flujo real de Transbank vive en el juego de endpoints `.../pay/redirect`
  paralelo (`StartRedirectPaymentService`/`ConfirmRedirectPaymentService`,
  ver mas abajo). Para prepago de pedido QR y pago de cuenta abierta esta
  implementado, probado y en produccion de punta a punta -- backend y
  frontend -- desde la Fase 2 (ver doc `docs/22-transbank-webpay-integracion.md`
  para el detalle completo). El endpoint `.../pay/redirect` de split bill
  esta implementado igual en el backend, pero **no** tiene contraparte
  frontend todavia -- ver el gap siguiente.
- **Gap real: split bill no ofrece Transbank como opcion descubrible**.
  `GetBillSplitParticipantService.execute()`
  (`application/get-bill-split-participant.service.ts`) resuelve la pasarela
  del participante llamando
  `RestaurantPaymentAccountRepository.findByRestaurant()`
  (`infrastructure/mercado-pago/restaurant-payment-account.repository.ts`),
  que filtra **siempre** por `provider: MERCADO_PAGO` sin importar que
  cuentas esten realmente conectadas, y ademas hardcodea
  `provider: PaymentGatewayProvider.MERCADO_PAGO` en la respuesta cuando hay
  match. Efecto real: un restaurante que solo tenga Transbank conectado (sin
  Mercado Pago) hace que `GET /qr/split-participants/:token` devuelva
  `gatewayConnected: false` para ese participante, **aunque el endpoint de
  cobro para ese mismo participante
  (`POST split-participants/:token/pay/redirect`,
  `StartRedirectPaymentService.startForSplitParticipant`) si funciona** si el
  cliente lo llama directo. El bug esta solo en el descubrimiento
  (`GET .../split-participants/:token`), no en el cobro. El patron correcto
  ya existe en el mismo modulo:
  `GetQrPaymentConfigService.execute()`
  (`application/get-qr-payment-config.service.ts`) usa
  `RestaurantPaymentAccountRepository.findConnectedByRestaurant()` (todas las
  cuentas `CONNECTED`, cualquier proveedor) + `PaymentGatewayRegistry` para
  construir `options[]`; `GetBillSplitParticipantService` deberia hacer lo
  mismo en vez de su propio camino de un solo proveedor. Confirmado tambien
  por `get-bill-split-participant.service.spec.ts`, que solo cubre el camino
  Mercado Pago. Este gap tiene ademas una contraparte frontend: `split-payment.tsx`
  en `sazono-ui` no tiene ningun camino de codigo (ni UI ni llamada API)
  hacia el endpoint `.../pay/redirect` que si funciona en este backend --
  arreglar solo el backend no cierra el flujo, ver
  `sazono-ui/docs/03-frontend-ai-context.md` y
  `sazono-ui/docs/19-transbank-y-checkout-multi-proveedor.md` para el estado
  real del lado frontend. Ver tambien
  `docs/24-pagos-vision-general.md` (matriz de capacidad flujo x proveedor).

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
`PaymentGatewayResolverService.resolveAvailable(restaurantId)`, que devuelve
TODAS las cuentas `CONNECTED` del restaurante (no solo Mercado Pago),
ordenadas por `displayPriority` DESC y `connectedAt` ASC. `ChargePaymentService`
cobra siempre a traves de la primera opcion de ese arreglo (la de mayor
prioridad); el resto queda disponible para que otros consumidores (por
ejemplo `payment-config`) los ofrezcan igual. Cada adapter es un provider de
Nest sin estado (singleton, sin credenciales en el constructor): el
`accessToken` u otra credencial de cada restaurante viaja en
`GatewayChargeContext.credentials`/`getPayment(..., credentials)` en cada
llamada, nunca en el constructor.

Los adapters se descubren via `PaymentGatewayRegistry` (usa `DiscoveryService`
de `@nestjs/core`, `infrastructure/payment-gateway-registry.service.ts`): en
`onModuleInit` escanea todos los providers del modulo y arma un
`Map<PaymentGatewayProvider, PaymentGatewayPort>` leyendo la metadata que deja
el decorador `@PaymentGatewayAdapter(provider)`
(`domain/payment-gateway-adapter.decorator.ts`). Agregar un proveedor nuevo
implica: crear el adapter, decorarlo y registrarlo como provider normal en
`payments.module.ts` -- ni el resolver ni la registry se tocan para eso. La
UNICA excepcion es la resolucion de credenciales por proveedor dentro de
`PaymentGatewayResolverService.resolveCredentials`, que tiene un switch
exhaustivo (`MERCADO_PAGO` -> `accessToken` descifrado, `TRANSBANK` ->
`childCommerceCode`) y necesita un caso nuevo por cada forma de credencial
distinta que aparezca. Ver doc 23 (`23-arquitectura-multi-proveedor-de-pago.md`)
para la guia paso a paso de agregar un proveedor nuevo.

El puerto `PaymentGatewayPort.charge()` devuelve un `GatewayChargeOutcome`
discriminado por `kind`: `SETTLED` (resultado inmediato, `APPROVED` o
`REJECTED`, como Mercado Pago) o `REDIRECT` (la pasarela necesita mandar al
cliente a una URL externa, como Transbank Webpay). `ChargePaymentService` y
los 3 casos de uso de pago QR con checkout embebido (`pay-qr-order`,
`settle-bill-payment` usado por `pay-qr-bill`/`pay-bill`, y
`pay-bill-split-participant`) manejan ambas ramas con un switch exhaustivo
(`assertNever` en `domain/assert-never.ts` hace que TypeScript falle el build
si falta un caso). Esos 3 casos de uso siguen usando el helper compartido
`application/require-settled-charge.ts`, que ante un `REDIRECT` lanza un
`ConflictException` explicito (`checkout` con `cardToken` solo tiene sentido
para una pasarela `embedded`) en vez de tratarlo como aprobado o rechazado.

Para pasarelas `redirect`, el flujo real vive en un juego de casos de uso
paralelo, no en los 3 de arriba: `StartRedirectPaymentService` (endpoints
`POST .../pay/redirect` en `qr-payments.controller.ts`) inicia el `charge()`
sin `checkout` y devuelve `{ redirectUrl, method, fields }` para que el
frontend haga un form-POST real; `ConfirmRedirectPaymentService` (endpoint
publico `POST payment-accounts/transbank/return`, sin guards, es a donde
Transbank redirige al cliente) confirma el resultado, y
`ReconcileTransbankPaymentsService` (job periodico, ver
`infrastructure/transbank/reconcile-transbank-payments.scheduler.ts`)
resuelve los intentos que quedaron `PENDING` porque el cliente nunca volvio.
Ver doc 22 para el detalle completo de este flujo y doc 23 para como se
generaliza a un tercer proveedor `redirect` distinto de Transbank.

`OFFLINE_PAYMENT_RECORDER` sigue siendo `OfflinePaymentRecorderAdapter`
(aprueba de inmediato).

El adapter de Mercado Pago (`infrastructure/mercado-pago/mercado-pago-gateway.adapter.ts`)
usa `binary_mode: true` (la API nunca devuelve `pending`) y, como respaldo
defensivo, si igual llegara un pago `pending`/`in_process` lo cancela y lo
trata como rechazado con log `WARN` para conciliacion manual. El
`application_fee` esta reservado en el puerto pero nunca se envia todavia
(queda para cuando Sazono cobre comision). Los campos especificos de tarjeta
(`cardToken`, `paymentMethodId`, `installments`, `issuerId`, `payerEmail`)
viajan como `checkoutPayload: unknown` en `GatewayChargeContext`; el adapter
los castea y valida internamente (`isMercadoPagoCheckoutPayload`) en vez de
vivir en el tipo comun del puerto.

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
