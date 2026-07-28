# Integracion de Mercado Pago

## Objetivo

Este doc explica de punta a punta como Sazono cobra pagos QR reales a traves
de Mercado Pago Chile (Checkout API + marketplace no custodial via OAuth por
restaurante): arquitectura de canales/puertos, conexion de cuenta por
restaurante, flujo de cobro, webhook de confirmacion, como probar todo en
local y las limitaciones conocidas. Es la lectura recomendada antes de tocar
`src/modules/payments`; el detalle linea a linea de cada endpoint sigue
viviendo en `src/modules/payments/README.md` (fuente de verdad mas
actualizada) y las reglas de negocio de prepago/split en doc 12 y doc 13.

Este doc reemplaza el diseño original de un solo adapter manual descrito
como "historico" en doc 12 (`PAYMENT_PROVIDER` / `ManualPaymentProviderAdapter`
ya no existen en el codigo).

**Nota (Fase 2):** desde que se agrego Transbank como segundo proveedor, la
arquitectura general de canales/puertos/registro-por-decorador que describe
la seccion "Arquitectura" de abajo dejo de ser exclusiva de Mercado Pago.
Esta doc se mantiene como referencia especifica de Mercado Pago (OAuth,
`binary_mode`, webhook con firma HMAC); el diseño multi-proveedor completo
-- por que los adapters son singletons con credenciales por-llamada, como
funciona `PaymentGatewayRegistry` con `DiscoveryService`, y como agregar un
proveedor nuevo paso a paso -- vive en
`docs/23-arquitectura-multi-proveedor-de-pago.md`. El flujo especifico de
Transbank (redireccion, conexion manual, conciliacion por polling) vive en
`docs/22-transbank-webpay-integracion.md`.

## Arquitectura: canal, no proveedor

Todo cobro pasa por `ChargePaymentService.execute()`, que decide la ruta
segun un `PaymentChannel` (`src/modules/payments/domain/payment-channel.ts`),
no segun "que proveedor esta activo":

- **`STAFF_OFFLINE`**: caja, supervisor o admin registrando dinero que el
  restaurante ya cobro por su cuenta (datafono propio, efectivo). Va directo
  al puerto `OFFLINE_PAYMENT_RECORDER` y nunca consulta ninguna pasarela real
  ni internet: aprueba siempre de inmediato.
- **`QR_ONLINE`**: pago publico iniciado desde el QR del cliente (prepago de
  orden, pago de cuenta abierta, pago de participante de split). Primero
  resuelve la cuenta conectada del restaurante via `PAYMENT_GATEWAY_RESOLVER`.
  Solo cobra de verdad si ademas llega un `checkout` (`cardToken` +
  `paymentMethodId` + `installments`) en el mismo request. Si falta la cuenta
  conectada o el checkout, cae al mismo registro offline **salvo** que
  `PAYMENTS_QR_GATEWAY_REQUIRED=true`, en cuyo caso se rechaza en vez de
  aprobar sin cobro real (ver "Limitaciones" mas abajo).

### Los puertos y por que son tres, no uno

- **`PaymentGatewayPort`** (`application/ports/payment-gateway.port.ts`):
  contrato de una pasarela real — `charge(context)`, `getPayment(...)` y,
  opcionalmente, `confirmRedirect(...)`. Lo implementan
  `MercadoPagoGatewayAdapter` y `WebpayMallGatewayAdapter` (Transbank, ver doc
  22); ambos son **providers normales de Nest, singletons, sin credenciales
  en el constructor** — el `accessToken`/`childCommerceCode` de cada
  restaurante viaja en `GatewayChargeContext.credentials` en cada llamada, no
  en el objeto. Se descubren automaticamente via `PaymentGatewayRegistry`
  (`DiscoveryService` de `@nestjs/core` + el decorador
  `@PaymentGatewayAdapter(provider)`), sin que el resolver ni la registry
  necesiten conocer sus clases concretas. Detalle completo del patron en doc
  23.
- **`PaymentGatewayResolverPort`** (`payment-gateway-resolver.port.ts`):
  dado un `restaurantId`, resuelve *todas* las pasarelas conectadas
  (`resolveAvailable`, no una sola). Implementado por
  `PaymentGatewayResolverService`, que busca las `RestaurantPaymentAccount`
  `CONNECTED` del restaurante (ordenadas por `displayPriority` DESC,
  `connectedAt` ASC), descifra el access token de Mercado Pago (o lee el
  `childCommerceCode` de Transbank) y arma el `ResolvedPaymentGateway`
  correspondiente apuntando al singleton de `PaymentGatewayRegistry` — nunca
  una cuenta global de Sazono.
- **`OfflinePaymentRecorderPort`** (`offline-payment-recorder.port.ts`):
  puerto separado, no un adapter no-op de `PaymentGatewayPort`. Existe aparte
  porque el registro offline no tiene semantica de cobro real (sin
  `cardToken`, sin polling de estado, sin correlacion de webhook): siempre
  aprueba de forma sincrona. Forzarlo a implementar `PaymentGatewayPort`
  obligaria a fingir soporte para campos que nunca aplican.

### El modelo de datos ya soporta mas de un proveedor

`PaymentGatewayProvider` (enum Prisma) tiene `MERCADO_PAGO` y `TRANSBANK`.
`RestaurantPaymentAccount` es unica por `(restaurantId, provider)` (un
restaurante puede tener una cuenta de cada proveedor conectada a la vez) y
`PaymentWebhookEvent` por `(provider, eventId)`. Agregar un tercer proveedor
no requiere migrar estas tablas: alcanza con sumar un valor al enum, un nuevo
`PaymentGatewayPort` adapter decorado y su registro como provider en
`payments.module.ts` (ver doc 23, seccion "Agregar un proveedor #3").

## Conexion OAuth por restaurante

El flujo lo dispara un `ADMIN` desde el panel `/admin/payments` del frontend.
Endpoints en `PaymentAccountsController`:

1. **`POST /api/v1/payment-accounts/mercado-pago/authorization-url`**
   (staff, requiere rol `ADMIN` en al menos una sucursal via
   `BranchAccessService`). `StartPaymentAccountConnectionService` genera un
   `state` opaco (UUID), opcionalmente PKCE (`code_verifier`/
   `code_challenge` si `MERCADOPAGO_OAUTH_PKCE_ENABLED=true`), persiste un
   `PaymentOAuthState` con TTL de 10 minutos y deja (upsert) una
   `RestaurantPaymentAccount` en `PENDING` para ese restaurante+proveedor.
   Devuelve la `authorizationUrl` de Mercado Pago para redirigir al admin.
2. Mercado Pago redirige de vuelta a
   **`GET /api/v1/payment-accounts/mercado-pago/callback`** — el callback
   publico de ESTE backend, no del frontend (asi lo exige
   `MERCADOPAGO_OAUTH_REDIRECT_URI`, debe coincidir exacto con lo registrado
   en el panel de la app MP). `CompletePaymentAccountConnectionService`:
   - valida que el `state` exista, no este consumido y no haya expirado
   - lo marca consumido con un `updateMany` condicionado a
     `consumedAt: null` (evita doble consumo por una carrera de dos
     callbacks casi simultaneos)
   - intercambia el `code` por tokens (`MercadoPagoOAuthClient`)
   - persiste todo cifrado via `RestaurantPaymentAccountRepository`
     (`status: CONNECTED`, `publicKey`, `externalAccountId` = `user_id` de
     MP, `environment`, `liveMode`, `scope`)
   - si algo falla en el intercambio, marca la cuenta `ERROR` con el mensaje
   - en cualquier caso redirige el navegador a
     `PAYMENTS_OAUTH_UI_RETURN_URL?status=connected|error` (la pagina real
     `admin/payments` de `sazono-ui`)
3. **`GET /api/v1/payment-accounts/mercado-pago`** (`ADMIN`): estado de la
   cuenta sin exponer tokens.
4. **`DELETE /api/v1/payment-accounts/mercado-pago`** (`ADMIN`): desconecta,
   borra las columnas cifradas.

El access token se refresca solo: `getValidAccessToken` revisa
`accessTokenExpiresAt` y, si esta a menos de 7 dias de vencer, usa el
refresh token guardado para renovarlo antes de devolverlo.

### Cifrado de credenciales

`SecretCipherService` (`src/common/crypto/secret-cipher.service.ts`) cifra
`access_token`/`refresh_token` en reposo con AES-256-GCM:

- clave: `PAYMENTS_ENCRYPTION_KEY`, 32 bytes en base64 (generar con
  `openssl rand -base64 32`)
- IV aleatorio por cada `encrypt`
- AAD = `"<provider>:<restaurantId>"` — ata el texto cifrado a su dueno: un
  ciphertext cifrado para el restaurante A no descifra en el contexto del
  restaurante B aunque se use la misma clave
- formato guardado: `v1.<iv>.<authTag>.<ciphertext>`, todo en base64url

## Flujo de cobro: `binary_mode: true`

Cada caso de uso QR (`pay-qr-order`, `pay-qr-bill`,
`pay-bill-split-participant`) crea primero un `PaymentAttempt` en
`PENDING` y recien despues llama a `ChargePaymentService.execute({channel:
QR_ONLINE, ...})`.

`MercadoPagoGatewayAdapter.charge()` siempre envia `binary_mode: true` al
`POST /v1/payments` de Mercado Pago. Esto le pide a la API que la respuesta
sea **siempre** `approved` o `rejected`, nunca `pending`/`in_process`. La
razon de fondo: permite resolver todo el cobro en una sola transaccion
sincrona justo despues de la respuesta HTTP — `PaymentAttempt` a
`SUCCEEDED`, `Payment` creado, items cargados a la `Bill`, tickets
enrutados a cocina y orden a `ROUTED`, todo junto — sin depender de esperar
un webhook para saber si el cobro se aprobo.

Como respaldo defensivo, si Mercado Pago igual devolviera `pending` (caso no
documentado pero posible), el adapter cancela ese pago de inmediato
(`paymentClient.cancel`) y lo trata como `REJECTED` con un log `WARN` para
conciliacion manual, en vez de dejar un estado ambiguo.

- **Aprobado** -> `FinalizePaymentService` (idempotente: solo actualiza si el
  attempt seguia `PENDING`, protegido con `updateMany`) + aplicacion del
  cargo/pago a la `Bill` + ruteo a estaciones, todo en la misma transaccion
  Prisma que la del caso de uso.
- **Rechazado** -> `FailPaymentService` + orden a `PAYMENT_FAILED`; el
  cliente reintenta el mismo endpoint sin perder el pedido (un
  `PaymentAttempt` nuevo por intento).
- `applicationFeeAmount` (comision de plataforma) esta reservado en
  `GatewayChargeContext` y en `PAYMENTS_APPLICATION_FEE_BPS`, pero todavia no
  se envia a Mercado Pago — queda para cuando Sazono empiece a cobrar
  comision sobre el cobro.

## Webhook de confirmacion

`PaymentWebhooksController` expone
`POST /api/v1/webhooks/payments/mercado-pago`, publico, con `@SkipThrottle()`
(la ruta esta protegida por firma HMAC, no por el throttling global — el
verificador ya descarta cualquier request sin firma valida antes de llegar a
logica de negocio).

### 1. Verificacion de firma, antes de tocar la base de datos

`MercadoPagoSignatureVerifier` reconstruye el manifest exacto de la doc
oficial de Mercado Pago
(`id:<data.id, minusculas si es alfanumerico>;request-id:<x-request-id>;ts:<ts>;`,
omitiendo cualquier segmento cuyo valor no venga en la notificacion), firma
con HMAC-SHA256 usando `MERCADOPAGO_WEBHOOK_SECRET` y compara con
`timingSafeEqual` contra el `v1` del header `x-signature`. Tambien aplica una
ventana anti-replay (`MERCADOPAGO_WEBHOOK_TOLERANCE_SECONDS`, default 300s)
sobre el `ts`.

Si la firma es invalida, el controller lanza `401` **antes** de invocar
`HandleMercadoPagoWebhookService` — no se escribe nada en
`PaymentWebhookEvent`. Esto es deliberado, no solo "fail fast": el
`eventId` de idempotencia sale del `id` del **body**, que un caller no
autenticado controla por completo. Si se guardara esa fila antes de verificar
la firma, un atacante podria pre-sembrar `eventId`s para que notificaciones
reales futuras de Mercado Pago con ese mismo id lleguen y se descarten como
"duplicado" sin procesarse nunca — un DoS de idempotencia contra uno mismo.
Verificar primero garantiza que una firma invalida nunca deja rastro en la
tabla.

### 2. Idempotencia

`HandleMercadoPagoWebhookService` corta por `PaymentWebhookEvent.eventId` =
`id` del body (no `x-request-id`, que Mercado Pago no garantiza estable entre
reintentos de la misma notificacion). Un `eventId` repetido corta antes de
tocar cualquier otra tabla o red.

### 3. Correlacion

- Tipos distintos de `payment` (`merchant_order`, `mp-connect`, etc.) se
  marcan procesados sin mas trabajo.
- Primero intenta `PaymentAttempt` por `(provider, providerReference)` usando
  el `data.id` de la notificacion.
- Si no hay match, resuelve la `RestaurantPaymentAccount` por
  `externalAccountId` = `user_id` del body, arma el gateway de ESE
  restaurante via `PAYMENT_GATEWAY_RESOLVER` y usa
  `getPayment().externalReference` (el `attemptId` original enviado como
  `external_reference` al cobrar) para encontrar el `PaymentAttempt`.
- **Siempre** reconsulta `gateway.getPayment(dataId)` antes de decidir
  (reusa la respuesta si el fallback anterior ya tuvo que pedirla): la
  notificacion en si nunca trae el estado del pago para el topico `payment`,
  solo dispara la consulta.

### 4. Aplicacion del resultado

- `approved` -> `FinalizePaymentService` + aplicacion a la `Bill`, pero solo
  si el `PaymentAttempt` seguia `PENDING` (con `binary_mode: true` esto
  deberia ser rarisimo: solo pasa si el proceso se cayo entre el `charge()`
  sincrono y el `finalize` del flujo normal — ver limitaciones).
- `rejected`/`cancelled` -> `FailPaymentService`, y si el intento venia de
  una orden QR tambien marca la orden `PAYMENT_FAILED`.
- `in_process`/`pending` -> no-op, solo actualiza
  `providerStatus`/`providerStatusDetail` para trazabilidad.
- Intento ya en estado terminal (caso normal) -> el webhook solo actualiza
  `providerStatus`/`providerStatusDetail` para auditoria, nunca vuelve a
  llamar `FinalizePaymentService`/`FailPaymentService`.
- Cualquier error atrapado se guarda en `PaymentWebhookEvent.processError` y
  el evento igual queda `processedAt`; la respuesta HTTP sigue siendo `200`
  (reintentar la misma notificacion no ayuda si el fallo es de correlacion,
  y Mercado Pago reintenta cada ~15 min indefinidamente si no responde
  200/201).

`ChargePaymentService` envia `notificationUrl` (= `MERCADOPAGO_WEBHOOK_URL`)
en cada `charge()` real, ademas de la URL configurada en el panel de la app.

## Como probar todo localmente

1. En `.env`, habilita el bloque de Mercado Pago
   (`MERCADOPAGO_ENABLED=true` + credenciales sandbox +
   `PAYMENTS_ENCRYPTION_KEY`) — ver `.env.example`, que es la fuente de
   verdad de cada variable y no se repite aqui.
2. **Conexion OAuth**: logueate como `ADMIN`, llama
   `POST /payment-accounts/mercado-pago/authorization-url`, abre la URL
   devuelta, completa el login sandbox de Mercado Pago y confirma que el
   callback redirige a `admin/payments?status=connected`.
3. **Cobro**: usa una tarjeta de prueba oficial de Mercado Pago sandbox a
   traves del checkout Bricks del frontend (`features/mercado-pago-checkout`
   en `sazono-ui`) — este backend nunca ve el numero de tarjeta, solo el
   `cardToken` que emite el SDK de Mercado Pago en el navegador.
4. **Webhook**: expone el backend local con un tunel (ngrok, cloudflared,
   etc.), apunta `MERCADOPAGO_WEBHOOK_URL` a esa URL publica y suscribe la
   misma URL en el panel de Webhooks de la app MP. Dos formas de disparar la
   notificacion:
   - dejar que Mercado Pago la mande sola tras un cobro sandbox real, o
   - generar una notificacion sintetica y correctamente firmada con
     `scripts/mp-webhook-curl.mjs` (usa el mismo manifest y algoritmo
     HMAC-SHA256 que `MercadoPagoSignatureVerifier`):

     ```bash
     MERCADOPAGO_WEBHOOK_SECRET=<la misma que .env> \
       node scripts/mp-webhook-curl.mjs [dataId] [baseUrl]
     ```

     Imprime un comando `curl` listo para ejecutar, con `x-signature`
     valida. Sirve para probar los caminos de firma/idempotencia/`DEFERRED`
     sin gastar un pago sandbox real; para probar una reconciliacion
     `approved` de punta a punta hace falta que `dataId` sea el id de un
     pago sandbox real que Mercado Pago pueda devolver via `getPayment`.

## Variables de entorno

Todas las variables de Mercado Pago y pagos en general estan documentadas
inline en `.env.example` (bloque `MERCADOPAGO_*` y `PAYMENTS_*`) — esa es la
fuente de verdad, no se listan de nuevo aqui para evitar que se desincronicen.

## Limitaciones y gaps conocidos

- **`PAYMENTS_QR_GATEWAY_REQUIRED=false` por default**: un pago QR sin cuenta
  conectada (o con checkout incompleto) cae silenciosamente a registro
  offline en vez de rechazarse. Es el default deliberado del MVP para que el
  pedido QR siga funcionando antes de que todos los restaurantes conecten
  una pasarela, pero implica que "aprobado" no siempre significa "el dinero
  paso de verdad por Mercado Pago" a menos que se active esta bandera.
- **Gap de reconciliacion en el caso raro de crash entre `binary_mode` y
  finalize**: si el webhook llega a reconciliar un intento que seguia
  `PENDING`, hoy solo ejecuta `FinalizePaymentService` + aplicacion del
  cargo a la `Bill` (con `tipDelta = 0`, porque el reparto original
  tip/monto no se puede reconstruir de forma confiable solo desde el
  `PaymentAttempt`). Los efectos adicionales del flujo original — ruteo a
  cocina (`pay-qr-order`) o actualizacion del split
  (`pay-bill-split-participant`) — **no** se re-ejecutan automaticamente;
  queda para revision manual (`PaymentWebhookEvent.processError` + el log
  `WARN` que deja el servicio).
- **`application_fee` reservado, no activo**: el campo y la variable
  `PAYMENTS_APPLICATION_FEE_BPS` existen pero no se envian a Mercado Pago;
  Sazono todavia no cobra comision de plataforma.
- **Sin reembolsos/anulaciones** con impacto financiero sobre ordenes ya
  pagadas (mismo gap que doc 12).

## Referencias

- doc 24 (`24-pagos-vision-general.md`) — mapa de flujos de dinero, por que
  existen dos pasarelas y que esta activo por configuracion
- `src/modules/payments/README.md` — detalle linea a linea de endpoints y
  del modulo, se actualiza mas seguido que este doc
- doc 22 (`22-transbank-webpay-integracion.md`) — segundo proveedor,
  especifico de Transbank
- doc 23 (`23-arquitectura-multi-proveedor-de-pago.md`) — arquitectura
  general de canales/puertos/registro por decorador, y como agregar un
  proveedor nuevo
- doc 12 (`12-payments.md`) — reglas de negocio de prepago QR, pago de
  cuenta y split; seccion "Proveedor de pago" apunta aqui
- doc 13 (`13-payments-split-and-resolution.md`) — split bill, entrega,
  cancelacion, abandono
- `sazono-ui/docs/18-mercado-pago-checkout.md` — lado frontend: Checkout
  Bricks, `cardToken`, panel `admin/payments`
- `.env.example` — variables de entorno
- `scripts/mp-webhook-curl.mjs` — generador de curl firmado para probar el
  webhook en local
