# Integracion de Transbank Webpay Plus Mall

## Objetivo

Segundo proveedor de pago de Sazono (Fase 2), registrado en el mismo
`PaymentGatewayRegistry` que arma la Fase 1 (Mercado Pago). Este doc cubre
solo lo especifico de Transbank: conexion manual, forma del adapter,
derivacion de `buyOrder`, el flujo completo de redireccion/confirmacion/
conciliacion, y como probarlo en vivo contra el ambiente de integracion
real. El diseño multi-proveedor general (por que los adapters son
singletons, `PaymentGatewayRegistry` con `DiscoveryService`, como agregar un
proveedor #3) vive en `docs/23-arquitectura-multi-proveedor-de-pago.md`; lo
especifico de Mercado Pago (OAuth, `binary_mode`, webhook) en
`docs/21-mercado-pago-integracion.md`; el detalle linea a linea de cada
endpoint sigue viviendo en `src/modules/payments/README.md` (fuente de
verdad mas actualizada).

## Por que Transbank es distinto de Mercado Pago

- **`checkoutMode: 'redirect'`**, no `'embedded'`: Sazono nunca ve el numero
  de tarjeta. `charge()` crea la transaccion en Transbank y devuelve una URL
  + token a los que hay que redirigir al cliente via POST; Transbank cobra en
  su propia pagina y despues devuelve el control a `TRANSBANK_RETURN_URL`.
- **Conexion manual, no OAuth**: Transbank no ofrece un flujo OAuth como
  Mercado Pago. El ADMIN del restaurante ingresa directamente su
  `childCommerceCode` (el codigo de tienda hija que Transbank le asigna
  dentro del Mall de Sazono).
- **Credencial secreta de PLATAFORMA, no por restaurante**: a diferencia del
  `accessToken` de Mercado Pago (propio de cada restaurante, obtenido via
  OAuth y cifrado en `restaurant_payment_accounts`), la `TRANSBANK_API_KEY`
  es una sola, de Sazono como comercio Mall, vive en el `.env` del backend y
  nunca se guarda en la base de datos. Lo unico que se guarda por restaurante
  es el `childCommerceCode` (dato publico, no secreto).
- **Modelo Mall**: Transbank distingue un "codigo de comercio Mall" (el
  comercio padre, uno solo, de Sazono) de "codigos de comercio hijos" (uno
  por restaurante/tienda). Cada `create()` manda AMBOS: el `Options` se
  construye con el codigo Mall + la llave de plataforma, y el `details[]`
  del `create()` lleva el `childCommerceCode` de ESE restaurante.

## SDK oficial

`transbank-sdk` (npm, mantenido por TransbankDevelopers,
`github.com/TransbankDevelopers/transbank-sdk-nodejs`). Superficie usada:

```ts
import { WebpayPlus, Options, Environment, TransactionDetail } from 'transbank-sdk';

const transaction = new WebpayPlus.MallTransaction(
  new Options(mallCommerceCode, apiKey, Environment.Integration, timeoutMs),
);

const { token, url } = await transaction.create(buyOrder, sessionId, returnUrl, [
  new TransactionDetail(amount, childCommerceCode, buyOrder),
]);

const commitResult = await transaction.commit(token);
const statusResult = await transaction.status(token);
```

`create/commit/status` devuelven `Promise<any>` (el SDK no tipa las
respuestas); `webpay-mall-gateway.adapter.ts` define sus propios tipos
locales (`TransbankCreateResponse`, `TransbankCommitResponse`) y valida la
forma en runtime antes de confiar en los campos.

Limites documentados (`ApiConstants` del SDK, confirmados leyendo el fuente):
`buyOrder` <= 26 caracteres, `sessionId` <= 61, `returnUrl` <= 255, `token`
= 64 caracteres, `commerceCode` = 12 caracteres. CLP no admite decimales
(`infrastructure/transbank/transbank-amount.ts` lo valida y redondea/rechaza
antes de llamar al SDK, igual que `mercado-pago-amount.ts` para Mercado
Pago).

## Derivacion de `buyOrder`

El `attemptId` interno de Sazono es un UUID (36 caracteres) y no cabe en los
26 caracteres que exige Transbank. `domain/transbank-buy-order.ts` deriva un
`buyOrder` deterministico: `sz-` + los primeros 23 caracteres hex de
`sha256(attemptId)` = siempre 26 caracteres exactos. No es reversible al
`attemptId` original a proposito (no hace falta: la correlacion real hacia
`PaymentAttempt` se hace por `providerReference`, que es el `token` de 64
caracteres que Transbank devuelve en `create()`, guardado en el intento).

## Mapeo de estado

`domain/transbank-status.ts` mapea el resultado de `commit()`/`status()` a
`APPROVED`/`REJECTED`: para Webpay Plus Mall, el resultado real vive en
`response.details[0]` (un array porque el mismo `token` puede en teoria
cubrir varias tiendas hijas; Sazono siempre manda una sola). Solo
`details[0].status === 'AUTHORIZED' && details[0].response_code === 0` es
`APPROVED`; cualquier otro `status` (`FAILED`, `NULLIFIED`,
`PARTIALLY_NULLIFIED`, `REVERSED`, etc.) o `response_code !== 0` es
`REJECTED`. Doc oficial de referencia:
`TRANSBANK_WEBPAY_STATUS_DOCS_URL` en `domain/transbank-status.ts`.

## Conexion manual por restaurante

Endpoints en `PaymentAccountsController`, todos bajo
`payment-accounts/transbank`, rol ADMIN para conectar/desconectar:

1. `POST /api/v1/payment-accounts/transbank` con
   `{ childCommerceCode, environment? }`. `ConnectTransbankAccountService`
   valida `TRANSBANK_ENABLED`, exige rol ADMIN via `BranchAccessService`, y
   hace upsert de `RestaurantPaymentAccount` (`status: CONNECTED`,
   `provider: TRANSBANK`, `childCommerceCode`, `environment` = el del body o
   `TRANSBANK_ENVIRONMENT` por defecto).
2. `GET /api/v1/payment-accounts/transbank`: estado de la cuenta, sin
   exponer la llave de plataforma (esa nunca viaja en la respuesta, vive
   solo en `.env`).
3. `DELETE /api/v1/payment-accounts/transbank`: `status: DISCONNECTED`,
   borra el `childCommerceCode` guardado.

Los mismos endpoints genericos de la Fase 1 (`PATCH
.../:provider/pause|resume|preferred`) funcionan igual para
`provider=TRANSBANK` sin cambios: no hubo que tocarlos.

## El checkout redirect vive en endpoints propios, separados de los de checkout embebido

`ChargePaymentService.execute()` (usado por `pay-qr-order`,
`pay-qr-bill`/`pay-bill` y `pay-bill-split-participant`) solo intenta cobrar
de verdad cuando el request trae `checkout` (`cardToken` + `paymentMethodId`
+ `installments`). Ese concepto es exclusivo de pasarelas `embedded` como
Mercado Pago: Webpay nunca recibe datos de tarjeta de Sazono. Por eso esos 3
casos de uso, via el helper `require-settled-charge.ts`, rechazan con un
`ConflictException` explicito si la pasarela resuelta resulta ser
`checkoutMode: 'redirect'` — no la usan, ni por accidente ni a proposito.

El flujo de pago real con Transbank pasa por un endpoint **distinto**, uno
por cada punto de cobro, que no pide `checkout` y en cambio devuelve los
datos para un form-POST hacia la pasarela:

| Endpoint | Caso de uso | Cobra |
|---|---|---|
| `POST tables/:qrToken/orders/:orderId/pay/redirect` | prepago de pedido QR | `StartRedirectPaymentService.startForQrOrder` |
| `POST tables/:qrToken/bill/payments/redirect` | pago de cuenta abierta | `StartRedirectPaymentService.startForQrBill` |
| `POST split-participants/:participantToken/pay/redirect` | pago de participante de split | `StartRedirectPaymentService.startForSplitParticipant` |

Los tres reciben `{ provider, amount?, tipAmount? }`, resuelven la cuenta
`CONNECTED` de ESE `provider` con `checkoutMode: 'redirect'` (rechazan con
`409` si no existe o no es de tipo redirect), crean el `PaymentAttempt`
`PENDING` y llaman `gateway.charge()` sin `checkout`. La respuesta
(`RedirectPaymentResponseDto`: `redirectUrl`, `method: 'POST'`, `fields`,
`expiresAt`) es lo que el frontend usa para armar el `<form>` real que
redirige al cliente a Webpay (ver doc frontend 19).

### Confirmacion: el endpoint publico al que Transbank redirige de vuelta

`POST payment-accounts/transbank/return` (`payment-accounts.controller.ts`,
publico, sin guards — Transbank redirige el navegador del cliente, que no
puede mandar `Authorization`) recibe `token_ws` (pago completado, hay que
confirmar) o `TBK_TOKEN` (el cliente cancelo en la pagina de Webpay, sin
`token_ws`). `ConfirmRedirectPaymentService.execute()`:

- con `token_ws`: busca el `PaymentAttempt` por `providerReference = token`
  entre los proveedores `redirect` registrados, llama
  `gateway.confirmRedirect(token, credentials)` y aplica el resultado
  (`SETTLED APPROVED` -> finaliza igual que el resto del modulo: aplica el
  cargo a la `Bill`, rutea a cocina si es una orden, actualiza el split si es
  un participante; `SETTLED REJECTED` -> `FailPaymentService`). Si el
  intento ya estaba resuelto (reintento del navegador, doble POST), reusa el
  resultado sin volver a llamar a Transbank.
- con `TBK_TOKEN` sin `token_ws`: el cliente aborto el pago en la pagina de
  Webpay: marca el intento `FAILED` con `ABORTED_FAILURE_REASON` sin
  consultar a Transbank (no hay nada que confirmar).
- sin ninguno de los dos: `TIMEOUT` (la sesion de pago expiro en Webpay).

Esta URL de retorno **no debe apuntar directo a este backend** en
`TRANSBANK_RETURN_URL` — ver el comentario de esa variable en `.env.example`
y doc frontend 19 para por que el proxy `sazono-ui`
(`app/api/pago/retorno/route.ts`) es el destino real.

### Conciliacion: Transbank no tiene webhooks

A diferencia de Mercado Pago, Transbank no notifica a Sazono cuando un pago
se resuelve — si el cliente paga pero cierra el navegador antes de que
Webpay lo redirija de vuelta, el `PaymentAttempt` queda `PENDING` para
siempre sin este mecanismo. `ReconcileTransbankPaymentsScheduler`
(`infrastructure/transbank/`, usa `SchedulerRegistry` de `@nestjs/schedule`,
se registra en `onModuleInit` **solo si** `TRANSBANK_ENABLED=true`) corre
cada `TRANSBANK_RECONCILIATION_INTERVAL_MS` y llama
`ReconcileTransbankPaymentsService.execute()`, que busca hasta 200
`PaymentAttempt` `PENDING` de Transbank con `providerReference` no nulo y mas
de `TRANSBANK_RECONCILIATION_MIN_AGE_MINUTES` de antiguedad, y para cada uno
llama `gateway.getPayment()` (via
`ConfirmRedirectPaymentService.reconcilePendingAttempt`, el mismo camino de
aplicacion del resultado que usa la confirmacion sincrona) para resolverlo.
Un `ConflictException` durante la conciliacion (el intento ya se resolvio
por otro camino mientras corria el job) se cuenta aparte
(`resolvedConcurrently`), no como error.

Terminado y verificado en esta fase:

- El adapter completo (`charge`/`confirmRedirect`/`getPayment`) contra la
  API real de Transbank (ver "Como probar en vivo" abajo).
- El registro en `PaymentGatewayRegistry` (mismo mecanismo de discovery que
  Mercado Pago, sin tocar la registry).
- `PaymentGatewayResolverService.resolveAvailable` incluye una cuenta
  Transbank `CONNECTED` en el arreglo de gateways disponibles del
  restaurante.
- `GET /qr/tables/:qrToken/payment-config` expone la opcion Transbank
  (`checkoutMode: 'redirect'`) de forma completamente generica.
- Conexion/pausa/reanudacion/prioridad/desconexion manual, end-to-end.
- Los 3 endpoints `.../pay/redirect` (backend, incluido el de split
  participant), el endpoint publico de confirmacion y el job de
  conciliacion.
- El lado frontend de prepago de pedido QR y pago de cuenta abierta
  (selector de pasarela, form-POST, pagina de retorno) — ver doc frontend
  19. **El de split bill queda afuera, ver el gap siguiente.**

Lo que queda para una fase siguiente (fuera del alcance de esta):

- Reembolsos/anulaciones sobre pagos Transbank ya aprobados.
- `application_fee`/comision de plataforma sobre cobros Transbank (mismo gap
  que Mercado Pago, ver doc 21).
- **Split bill no soporta Transbank de punta a punta.** El endpoint de cobro
  (`POST split-participants/:token/pay/redirect`) existe y funciona igual
  que los otros dos, pero `GET /qr/split-participants/:token`
  (`GetBillSplitParticipantService`) hardcodea `provider: MERCADO_PAGO` al
  resolver la pasarela del participante (usa
  `RestaurantPaymentAccountRepository.findByRestaurant()`, que filtra
  siempre por Mercado Pago, en vez de `findConnectedByRestaurant()` +
  `PaymentGatewayRegistry` como hace `GetQrPaymentConfigService` para los
  otros dos flujos) — un restaurante solo-Transbank ve
  `gatewayConnected: false` en ese endpoint aunque el cobro si funcionaria.
  Y el frontend (`split-payment.tsx`) no tiene ningun camino de codigo hacia
  ese endpoint de cobro, a diferencia de `payment-sheet.tsx`/
  `bill-pay-sheet.tsx`. Detalle completo en
  `src/modules/payments/README.md` (seccion "Transbank Webpay Plus Mall") y
  en `docs/24-pagos-vision-general.md` (matriz de capacidad).

## Como probar en vivo (ambiente de integracion real)

Transbank publica codigos de comercio y una llave API de integracion
PENSADOS para que cualquiera pruebe sin afiliarse, ya pre-cargados en el
propio SDK (`IntegrationCommerceCodes`, `IntegrationApiKeys`):

- Mall (padre): `597055555535`
- Tienda 1 (hija, usar como `childCommerceCode` de prueba): `597055555536`
- Llave API de integracion (compartida para TODOS los codigos de
  integracion): `579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C`
- Host de integracion: `https://webpay3gint.transbank.cl`
- Tarjeta de prueba (aprobada): VISA `4051 8856 0044 6623`, CVV `123`,
  cualquier fecha de expiracion futura
- Autenticacion bancaria simulada: RUT `11.111.111-1`, clave `123`

Doc oficial: `https://www.transbankdevelopers.cl/documentacion/como_empezar#ambientes`,
`https://www.transbankdevelopers.cl/documentacion/webpay-plus`,
`https://www.transbankdevelopers.cl/referencia/webpay`.

### Verificar solo `create()` (sin browser)

```js
const { WebpayPlus, Options, Environment, TransactionDetail, IntegrationCommerceCodes, IntegrationApiKeys } = require('transbank-sdk');

const transaction = new WebpayPlus.MallTransaction(
  new Options(IntegrationCommerceCodes.WEBPAY_PLUS_MALL, IntegrationApiKeys.WEBPAY, Environment.Integration, 15000),
);

transaction.create('buy-order-unico', 'session-1', 'https://tu-return-url', [
  new (require('transbank-sdk').TransactionDetail)(11800, IntegrationCommerceCodes.WEBPAY_PLUS_MALL_CHILD1, 'buy-order-unico'),
]).then((r) => console.log(r));
```

Devuelve `{ token, url }` reales contra `webpay3gint.transbank.cl` de
inmediato, sin tarjeta ni browser.

### Verificar `create()` + `commit()` de punta a punta (con browser)

Requiere completar el formulario Webpay real (elegir "Tarjetas", ingresar la
tarjeta de prueba, autenticarse con el RUT/clave de prueba) y capturar el
`token_ws` que Transbank reenvia por POST a tu `returnUrl` para recien ahi
llamar `commit(token_ws)`. Pasos manuales (navegador normal):

1. Corre el snippet de `create()` de arriba con un `returnUrl` real que
   controles (por ejemplo un tunel ngrok a un endpoint que solo haga
   `console.log(req.body)`).
2. Arma un HTML con un `<form method="POST" action="<url>">` y un
   `<input type="hidden" name="token_ws" value="<token>">`, y envialo (asi
   es como el frontend real inicia el redirect, Transbank exige POST).
3. En la pagina de Webpay: click en "Tarjetas", ingresa
   `4051 8856 0044 6623`, click "Continuar", completa vencimiento (cualquier
   fecha futura, ej `12/30`) y CVV `123`, click "Pagar".
4. Pagina de autenticacion del banco simulado: RUT `11.111.111-1`, clave
   `123`, "Aceptar".
5. Pagina "Elija una opcion": selecciona "Aceptar" en el combo, click
   "Continuar".
6. Transbank redirige (POST) a tu `returnUrl` con `token_ws` en el body.
7. Con ese `token_ws`, llama `transaction.commit(token_ws)` (mismo objeto
   `transaction` u otro construido con las mismas credenciales de
   integracion) y confirma que la respuesta trae
   `details[0].status === 'AUTHORIZED'` y `details[0].response_code === 0`.

### De punta a punta contra la app real (backend + frontend)

1. En `.env` del backend: `TRANSBANK_ENABLED=true`,
   `TRANSBANK_MALL_COMMERCE_CODE`/`TRANSBANK_API_KEY` con los valores de
   integracion de arriba, `TRANSBANK_ENVIRONMENT=integration`, y
   `TRANSBANK_RETURN_URL=http://localhost:3001/api/pago/retorno` (el proxy de
   `sazono-ui`, **no** un endpoint del backend directamente — ver el
   comentario de esa variable en `.env.example`).
2. Corre ambos repos (`npm run start:dev` backend en :3000,
   `npm run dev` frontend en :3001).
3. Como `ADMIN`, conecta Transbank desde `/admin/payments` con
   `childCommerceCode = 597055555536` (tienda de integracion) y
   `environment = integration`; opcionalmente marcalo preferido si tambien
   hay Mercado Pago conectado (`PATCH .../transbank/preferred`).
4. Desde el QR de una mesa (`/qr`), inicia un pedido o abre la cuenta, elige
   "pagar" y selecciona la opcion Transbank en el picker
   (`checkoutMode: 'redirect'`) — ver doc frontend 19 para el detalle de ese
   picker.
5. En la pagina de Webpay, paga con la tarjeta de prueba de arriba. Transbank
   redirige el navegador (POST) a `TRANSBANK_RETURN_URL`, que rebota (303) a
   `/[locale]/pago/retorno`, que confirma el pago llamando al backend y
   muestra el resultado.
6. Para forzar el camino de conciliacion (en vez de confirmacion sincrona):
   paga en Webpay pero cierra la pestaña antes de que redirija de vuelta. El
   `PaymentAttempt` queda `PENDING`; espera
   `TRANSBANK_RECONCILIATION_MIN_AGE_MINUTES` (o bajalo temporalmente a `0`
   en `.env` para no esperar) y el job periodico lo resuelve solo — confirma
   en los logs del backend (`ReconcileTransbankPaymentsService`).

## Variables de entorno

Documentadas inline en `.env.example` (bloque `TRANSBANK_*`), no se repiten
aqui para evitar que se desincronicen.

## Referencias

- `docs/24-pagos-vision-general.md` — mapa de flujos de dinero, que esta
  activo por configuracion y la matriz de capacidad flujo x proveedor
- `docs/23-arquitectura-multi-proveedor-de-pago.md` — arquitectura general y
  como agregar un proveedor #3
- `docs/21-mercado-pago-integracion.md` — primer proveedor, especifico de
  Mercado Pago
- `sazono-ui/docs/19-transbank-y-checkout-multi-proveedor.md` — lado
  frontend: picker de pasarela, form-POST de redireccion, pagina de retorno
- `src/modules/payments/README.md` — detalle linea a linea de endpoints del
  modulo
