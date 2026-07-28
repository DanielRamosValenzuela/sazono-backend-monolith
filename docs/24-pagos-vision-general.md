# Pagos: vision general

## Objetivo

Este doc es el punto de entrada al sistema de pagos de Sazono. Antes de leer
doc 12/13 (reglas de negocio) o doc 21/22/23 (cada pasarela y la arquitectura
multi-proveedor), lee esto primero para tener el mapa completo: por que
existen dos pasarelas, todos los flujos de dinero que existen, que esta
activo hoy vs inactivo por falta de configuracion, y — lo mas importante —
una matriz explicita de que combinacion flujo x proveedor funciona de punta
a punta hoy y cual no. No repite detalle de implementacion; cada seccion
apunta al doc que lo tiene.

## Mapa de que doc leer segun que necesites

| Necesito... | Leer |
|---|---|
| El mapa completo antes de tocar cualquier cosa de pagos | este doc |
| Reglas de negocio: prepago QR, pago de cuenta, invariantes | doc 12 (`12-payments.md`) |
| Reglas de negocio de split bill, entrega, cancelacion, abandono | doc 13 (`13-payments-split-and-resolution.md`) |
| Como funciona Mercado Pago especificamente (OAuth, `binary_mode`, webhook) | doc 21 (`21-mercado-pago-integracion.md`) |
| Como funciona Transbank especificamente (redireccion, conexion manual, conciliacion) | doc 22 (`22-transbank-webpay-integracion.md`) |
| El patron general (puertos, adapters singleton, registro por decorador) y como agregar un proveedor #3 | doc 23 (`23-arquitectura-multi-proveedor-de-pago.md`) |
| El detalle linea a linea de cada endpoint del modulo | `src/modules/payments/README.md` |
| Cada variable de entorno de pagos | `.env.example` (bloques `MERCADOPAGO_*`, `TRANSBANK_*`, `PAYMENTS_*`) |
| El lado frontend (checkout Bricks, picker de pasarela, pagina de retorno) | `sazono-ui/docs/18-mercado-pago-checkout.md` y `sazono-ui/docs/19-transbank-y-checkout-multi-proveedor.md` |

## Por que existen dos pasarelas

Ningun proveedor cubre todo Chile igual de bien, y Sazono no quiere apostar
la plataforma a uno solo. Mercado Pago y Transbank Webpay resuelven el mismo
problema (cobrar con tarjeta al comensal) con arquitecturas casi opuestas:

| | Mercado Pago Chile | Transbank Webpay Plus Mall |
|---|---|---|
| `checkoutMode` | `embedded` — Sazono recibe un `cardToken` generado en el navegador por el SDK de MP, nunca ve el numero de tarjeta | `redirect` — el cliente sale a la pagina de Webpay a pagar; Sazono nunca ve datos de tarjeta en absoluto |
| Conexion de cuenta por restaurante | OAuth marketplace no custodial (el restaurante autoriza a Sazono desde su propia cuenta MP) | Manual: el ADMIN ingresa directamente su `childCommerceCode` (Transbank no ofrece OAuth) |
| Credencial guardada por restaurante | `accessToken`/`refreshToken` cifrados (AES-256-GCM) en `restaurant_payment_accounts` | `childCommerceCode` (dato publico, no secreto) |
| Credencial de plataforma | `MERCADOPAGO_CLIENT_ID`/`MERCADOPAGO_CLIENT_SECRET` (para el intercambio OAuth) | `TRANSBANK_API_KEY` + `TRANSBANK_MALL_COMMERCE_CODE`, unica para toda la plataforma, vive solo en `.env` |
| Resultado del cobro | Resuelto en la misma llamada HTTP (`binary_mode: true`, nunca `pending`) → `kind: 'SETTLED'` | Requiere que el cliente vuelva del sitio de Webpay → `kind: 'REDIRECT'` primero, se confirma despues |
| Confirmacion asincrona | Webhook (`POST /webhooks/payments/mercado-pago`, firmado HMAC) | No tiene webhooks: el cliente vuelve por POST a `TRANSBANK_RETURN_URL`, o si nunca vuelve, un job de conciliacion por polling lo resuelve |
| Doc especifico | doc 21 | doc 22 |

Ambos implementan el mismo `PaymentGatewayPort` (doc 23) y ambos pueden estar
`CONNECTED` para el mismo restaurante a la vez — `displayPriority` decide
cual se usa por defecto, y `GET /qr/tables/:qrToken/payment-config` expone
las dos como `options[]` para que el cliente elija.

## El flujo de dinero completo: QR vs POS

Todo cobro pasa por `ChargePaymentService.execute()`, que decide la ruta por
`PaymentChannel` (`domain/payment-channel.ts`), no por "que proveedor esta
activo":

| Canal | Quien lo dispara | Puerto que usa | Pasa por una pasarela real | Casos de uso |
|---|---|---|---|---|
| `STAFF_OFFLINE` | Caja, supervisor o admin registrando dinero que el restaurante ya cobro con su propio datafono o efectivo | `OFFLINE_PAYMENT_RECORDER` (`OfflinePaymentRecorderAdapter`) | Nunca — aprueba siempre de inmediato, sin red | `POST /payments/bills/:billId` |
| `QR_ONLINE` | El cliente desde el QR de su mesa, sin autenticacion | `PAYMENT_GATEWAY_RESOLVER` (checkout embebido) o el flujo redirect paralelo | Solo si hay una cuenta `CONNECTED` y (checkout embebido) el request trae `checkout`, o (redirect) el cliente eligio una pasarela `redirect` explicitamente | prepago de pedido QR, pago de cuenta abierta, pago de un participante de split |

Dentro de `QR_ONLINE`, cada uno de los 3 puntos de cobro tiene **dos**
endpoints — uno de checkout embebido (recibe `cardToken`, cobra en la misma
llamada) y uno de redireccion (no recibe datos de tarjeta, devuelve una URL
para el form-POST):

| Flujo | Endpoint embebido | Endpoint redirect | Caso de uso |
|---|---|---|---|
| Prepago de pedido QR | `POST tables/:qrToken/orders/:orderId/pay` | `POST tables/:qrToken/orders/:orderId/pay/redirect` | `pay-qr-order` / `StartRedirectPaymentService.startForQrOrder` |
| Pago de cuenta abierta | `POST tables/:qrToken/bill/payments` | `POST tables/:qrToken/bill/payments/redirect` | `pay-qr-bill` / `startForQrBill` |
| Pago de participante de split | `POST split-participants/:token/pay` | `POST split-participants/:token/pay/redirect` | `pay-bill-split-participant` / `startForSplitParticipant` |

Si falta la cuenta conectada, el checkout, o si el cliente no elige ninguna
opcion `redirect`, el cobro cae al mismo registro offline de siempre — salvo
que `PAYMENTS_QR_GATEWAY_REQUIRED=true`, en cuyo caso se rechaza en vez de
aprobar sin cobro real. Ver doc 12 para las reglas de negocio de cada flujo
y doc 21/22 para el detalle de cada pasarela.

## Que esta activo hoy vs inactivo por configuracion

Ambas pasarelas son **opcionales** — un ambiente nuevo (o local, sin tocar
`.env`) arranca con las dos apagadas y el sistema sigue funcionando 100% en
modo offline (`STAFF_OFFLINE` siempre; `QR_ONLINE` cae a registro manual).

| Variable | Default | Efecto si esta en `false`/vacia |
|---|---|---|
| `MERCADOPAGO_ENABLED` | `false` | `PaymentAccountsController` sigue registrado, pero generar una `authorization-url` falla con `503` claro. El arranque nunca se rompe |
| `TRANSBANK_ENABLED` | `false` | Los endpoints `payment-accounts/transbank/*` fallan con `503` claro. `ReconcileTransbankPaymentsScheduler` nunca se registra (no hay job corriendo) |
| `PAYMENTS_QR_GATEWAY_REQUIRED` | `false` | Un pago QR sin cuenta conectada (o checkout incompleto) cae silenciosamente a registro offline en vez de rechazarse. Con `true`, se rechaza en vez de aprobar sin cobro real |
| `PAYMENTS_APPLICATION_FEE_BPS` | `0` | Sazono no cobra comision de plataforma sobre ningun cobro (campo reservado en el puerto, nunca enviado al proveedor todavia) |
| `PAYMENTS_ENCRYPTION_KEY` | vacia | Obligatoria si `MERCADOPAGO_ENABLED=true` (cifra `accessToken`/`refreshToken` en reposo); Transbank no la necesita (no guarda secretos por restaurante) |

Ver `.env.example` (bloques `MERCADOPAGO_*`, `TRANSBANK_*`, `PAYMENTS_*`)
para la lista completa de variables — es la fuente de verdad, no se repite
aqui.

Aun con ambas variables en `true` a nivel plataforma, cada restaurante
individual sigue necesitando conectar su propia cuenta (`RestaurantPaymentAccount.status = CONNECTED`)
para que `PAYMENT_GATEWAY_RESOLVER` lo resuelva. "Habilitado a nivel
plataforma" y "conectado a nivel restaurante" son dos capas independientes.

## Matriz de capacidad: flujo x proveedor

Esta es la tabla que habria evitado el gap de split bill quedando mal
documentado en otros docs. Lee `CONECTADO` como "el endpoint de cobro
funciona si el restaurante tiene ese proveedor `CONNECTED`"; lee
`NO DESCUBRIBLE` como "el cobro funcionaria si se llamara directo, pero no
hay forma de que un cliente sepa que existe esa opcion" (bug de
descubrimiento, no de cobro); lee `SIN FRONTEND` como "no hay codigo en
`sazono-ui` que llame a ese endpoint".

| Flujo | Mercado Pago (embedded) | Transbank (redirect) | Offline (STAFF_OFFLINE) |
|---|---|---|---|
| Prepago de pedido QR | CONECTADO | CONECTADO | CONECTADO (siempre disponible como fallback) |
| Pago de cuenta abierta (QR) | CONECTADO | CONECTADO | CONECTADO (siempre disponible como fallback) |
| Pago de participante de split | CONECTADO | **Backend: CONECTADO. Descubrimiento (`GET .../split-participants/:token`): NO DESCUBRIBLE (hardcodea Mercado Pago). Frontend (`split-payment.tsx`): SIN FRONTEND** | CONECTADO (siempre disponible como fallback) |
| Registro POS (caja/supervisor/admin) | N/A (no aplica, es `STAFF_OFFLINE`) | N/A | CONECTADO |

**El unico hueco real de la matriz es split bill + Transbank**, y tiene tres
partes independientes, las tres verificadas contra el codigo:

1. **Backend, cobro**: `POST split-participants/:token/pay/redirect`
   (`StartRedirectPaymentService.startForSplitParticipant`) funciona igual
   que los otros dos endpoints redirect. Esto SI esta conectado.
2. **Backend, descubrimiento**: `GetBillSplitParticipantService.execute()`
   (`src/modules/payments/application/get-bill-split-participant.service.ts`)
   resuelve la pasarela llamando
   `RestaurantPaymentAccountRepository.findByRestaurant()`
   (`infrastructure/mercado-pago/restaurant-payment-account.repository.ts`),
   que filtra **siempre** `provider: MERCADO_PAGO`, y ademas hardcodea ese
   mismo valor en la respuesta. Un restaurante con solo Transbank conectado
   ve `gatewayConnected: false` para split, aunque el cobro (punto 1) si
   funcionaria si se llamara directo. El arreglo correcto ya existe como
   patron en el mismo modulo: `GetQrPaymentConfigService.execute()` usa
   `findConnectedByRestaurant()` (todas las cuentas `CONNECTED`, cualquier
   proveedor) + `PaymentGatewayRegistry` para construir `options[]` — split
   deberia hacer lo mismo en vez de su propio camino de un solo proveedor.
3. **Frontend**: `sazono-ui/src/widgets/split-payment/ui/split-payment.tsx`
   no importa `PaymentMethodOptions`, no llama `qrApi.getPaymentConfig`, y no
   tiene ninguna mutation hacia `.../pay/redirect` — a diferencia de
   `payment-sheet.tsx` y `bill-pay-sheet.tsx`, que si soportan el picker
   multi-proveedor completo. Tampoco existe todavia un metodo
   `startSplitParticipantRedirectPayment` en `shared/api/qr-api.ts` del
   frontend. El shape que usa split
   (`shared/types/billing.ts BillSplitParticipantDetail`:
   `gatewayConnected`/`provider`/`publicKey`/`environment`) sigue siendo el
   de un solo proveedor, heredado de antes de Transbank, en vez del shape
   `options[]` que ya usa `QrPaymentConfigResponse`.

Este gap esta documentado con este nivel de detalle en
`src/modules/payments/README.md` (seccion "Transbank Webpay Plus Mall") y
resumido en doc 12 y doc 22; del lado frontend, ver
`sazono-ui/docs/03-frontend-ai-context.md` y
`sazono-ui/docs/19-transbank-y-checkout-multi-proveedor.md` para el estado
real (ninguno de los dos debe describir split como soportado para
Transbank).

**Arreglarlo requiere trabajo en los dos repos**: exponer `options[]` (o
campo equivalente) en el detalle del participante en este backend, y
reusar `PaymentMethodOptions`/el flujo de redirect ya existente en el
frontend. Mientras eso no pase, la alternativa aceptada es documentarlo como
limitacion del MVP (lo que hace esta tabla) en vez de dejarlo pasar como si
funcionara.

## Como agregar un proveedor #3

No lo repitas aca — es un procedimiento de 10 pasos con codigo, y vive
completo en doc 23, seccion "Agregar un proveedor #3, paso a paso"
(`docs/23-arquitectura-multi-proveedor-de-pago.md`).

## Gaps conocidos, en un solo lugar

Cada uno de estos aparece tambien en el doc especifico correspondiente (doc
12, 21 o 22); esta es la lista consolidada para no tener que leer los cuatro
para tener el panorama completo.

1. **Split bill no soporta Transbank de punta a punta** — ver la matriz de
   capacidad arriba. El unico gap de esta lista que es funcional, no solo de
   documentacion o de un caso borde raro.
2. **Reconciliacion incompleta tras un crash entre `binary_mode` y
   finalize**: en el caso rarisimo de que el proceso se caiga entre el
   `charge()` sincrono de Mercado Pago y el `finalize` del mismo request, el
   webhook que reconcilia despues solo ejecuta `FinalizePaymentService` +
   aplica el cargo a la `Bill` (con `tipDelta = 0`). Los efectos adicionales
   del flujo original — ruteo a cocina (`pay-qr-order`) o actualizacion del
   split (`pay-bill-split-participant`) — no se re-ejecutan automaticamente;
   queda para revision manual. Ver doc 21, seccion "Limitaciones y gaps
   conocidos".
3. **`application_fee` reservado, no activo**: el campo y
   `PAYMENTS_APPLICATION_FEE_BPS` existen en ambos proveedores pero no se
   envian todavia; Sazono no cobra comision de plataforma.
4. **Sin reembolsos ni anulaciones** con impacto financiero sobre ordenes o
   pagos ya aprobados, en ninguno de los dos proveedores.
5. **`PAYMENTS_QR_GATEWAY_REQUIRED=false` por default**: un pago QR sin
   pasarela conectada (o checkout incompleto) cae silenciosamente a registro
   offline en vez de rechazarse — "aprobado" no siempre significa "el dinero
   paso de verdad por una pasarela real" a menos que se active esta bandera.

## Referencias

- `src/modules/payments/README.md` — detalle linea a linea de endpoints y
  del modulo
- doc 12 (`12-payments.md`) — reglas de negocio de prepago QR, pago de
  cuenta y split
- doc 13 (`13-payments-split-and-resolution.md`) — split bill, entrega,
  cancelacion, abandono
- doc 21 (`21-mercado-pago-integracion.md`) — especifico de Mercado Pago
- doc 22 (`22-transbank-webpay-integracion.md`) — especifico de Transbank
- doc 23 (`23-arquitectura-multi-proveedor-de-pago.md`) — arquitectura
  general y como agregar un proveedor #3
- `.env.example` — variables de entorno
- `sazono-ui/docs/18-mercado-pago-checkout.md`,
  `sazono-ui/docs/19-transbank-y-checkout-multi-proveedor.md` — lado
  frontend
