# Migracion de Mercado Pago: Payments API a Orders API

Investigacion del 2026-10-06. Solo lectura, no se cambio codigo. Todo lo marcado
"no encontrado en doc" quedo sin confirmar y hay que probarlo en sandbox o
preguntarle a Mercado Pago antes de migrar.

## Por que

La app de Mercado Pago pide elegir "Tipo de API" y marca **API de Payments** con
"Esta API sera descontinuada pronto". No encontramos fecha de corte. El sucesor
es la Orders API (`POST /v1/orders`), y Mercado Pago publica una guia de
migracion (Biblioteca de prompts, "Migrar Checkout API de Payments a Orders API").
La doc de marketplace de Split 1:1 sigue hablando solo de `/v1/payments` y no
trae aviso de deprecacion.

## Que cambia en el cobro con tarjeta (documentado)

| Tema | Payments API (hoy) | Orders API |
|---|---|---|
| Endpoint | `POST /v1/payments` | `POST /v1/orders` (201) |
| Idempotencia | `X-Idempotency-Key` | `X-Idempotency-Key` obligatorio, 1 a 128 caracteres; repetida 409, bloqueada 423 |
| Monto | `transaction_amount` numero | `total_amount` y `payments[].amount` como string, suma igual al total |
| Tarjeta | `token`, `payment_method_id`, `installments`, `issuer_id` | `transactions.payments[].payment_method` con `id`, `type`, `token`, `installments` |
| Referencia | `external_reference` | `external_reference` (max 64, alfanumerico, `-` y `_`) |
| Binary mode | `binary_mode: true` | no hay campo equivalente documentado; existe `capture_mode` (`automatic`, `automatic_async`, `manual`) |
| Aviso de pago | `notification_url` por request | no existe por request; se configura solo en el panel (Webhooks, evento "Order") |
| Comision plataforma | `application_fee` | no encontrado en doc |
| Estados | `approved`, `pending`, `in_process`, `rejected` | order: `created`, `processing`, `processed`, `action_required`, `failed`, `canceled`, `expired`, `refunded`, `charged_back`; cada pago trae su `status_detail` |
| Consulta | `GET /v1/payments/{id}` | `GET /v1/orders/{id}` |
| Reembolso | no implementado en Sazono | `POST /v1/orders/{id}/refund` (total sin body, plazo 180 dias) |
| Cancelacion | `PUT /v1/payments/{id}` cancelled | `POST /v1/orders/{id}/cancel`, solo en `action_required` |

Notas: el card token del Brick (7 dias, un solo uso) sirve igual. La moneda no
aparece como campo en la doc de Orders, hay que probar como se resuelve para una
cuenta chilena. `3DS` en Orders usa `action_required` / `pending_challenge`.

## Webhooks de Orders

- Evento unico documentado: "Order (Mercado Pago)", `type=order`, `data.id` = id de la order (`ORD...`).
- Firma `x-signature`: manifest `id:[data.id];request-id:[x-request-id];ts:[ts];`, HMAC-SHA256 hex. Parece igual a Payments, pero no se verifico la comparacion.
- Responder 200 o 201 en 22 segundos; reintenta cada 15 minutos.
- Payload completo y `action` para refunded, canceled, expired y failed: no encontrado en doc.

## El bloqueo: marketplace con comision

Sazono cobra en nombre de cada restaurante (OAuth) y tiene reservado
`application_fee` para su comision. En la doc:

- Split 1:1 (nuestro modelo) documenta la comision solo con `application_fee` en `/v1/payments` (o `marketplace_fee` en Checkout Pro). No menciona `/v1/orders`.
- La referencia de `POST /v1/orders` no tiene `application_fee`.
- Split 1:N si usa Orders (`splits[]`, `POST /v1/split-consent`), pero la doc la ofrece para Argentina y Brasil, exige contacto comercial con Mercado Pago, y modela repartos entre varios vendedores, no una comision simple.
- No esta documentado si un access token OAuth de vendedor sirve para `POST /v1/orders`.
- No esta documentado si el webhook configurado en el panel de la app recibe los eventos de pagos hechos con tokens de vendedores conectados.

Conclusion: migrar hoy es viable para el cobro con tarjeta, pero no esta
demostrado que se pueda cobrar comision de plataforma. Como la monetizacion de
Sazono todavia no esta decidida (ver docs/07 raiz), este punto condiciona esa
decision.

## Alternativa documentada: Checkout Pro via Orders (hallazgo posterior)

La doc `checkout-pro-orders/additional-settings/integrate-marketplace` indica que
con Checkout Pro el marketplace usa el access token OAuth de cada vendedor y cobra
su comision con el campo `marketplace_fee` en `POST /v1/orders`; el comprador es
redirigido a una pagina de Mercado Pago, y la comision de Mercado Pago se descuenta
primero. Eso resolveria el bloqueo de la comision sin depender de Payments API, y
encaja con el patron redirect que Sazono ya tiene para Transbank
(`checkoutMode: 'redirect'`). Detalles aun sin leer: payload completo de la order de Checkout Pro,
back_urls, notificaciones y reembolsos en ese modo, y si los eventos de vendedores
OAuth llegan al webhook de la app. Es lo que debe validar el spike.

## Impacto en el codigo (mapeado)

`PaymentGatewayPort` es agnostico de Mercado Pago, asi que el cambio se concentra
en el adapter y el webhook. El contrato HTTP hacia la UI no cambia (el Brick sigue
entregando `cardToken`, `paymentMethodId`, `issuerId`, `installments`, `payerEmail`).

| Archivo (`src/modules/payments`) | Cambio |
|---|---|
| `infrastructure/mercado-pago/mercado-pago-gateway.adapter.ts` | nucleo: `charge()` a `POST /v1/orders`, `getPayment()` a `GET /v1/orders/{id}`, fallback de cancel a cancel de order; decidir si `providerReference` guarda el order id o el payment id; verificar si `mercadopago@^3.2.1` soporta Orders, si no usar `fetch` |
| `domain/mercado-pago-status.ts` | mapper nuevo de estados de order; hoy lo desconocido cae como REJECTED (peligroso con `action_required`/`processing`) |
| `infrastructure/mercado-pago/mercado-pago-amount.ts` | monto como string |
| `infrastructure/mercado-pago/mercado-pago-webhook-payload.ts` y `application/handle-mercado-pago-webhook.service.ts` | aceptar `type=order`, correlacion por order id; mantener correlacion por `external_reference` (es el camino que funciona si el webhook llega antes de guardar `providerReference`) |
| `scripts/mp-webhook-curl.mjs`, specs del adapter, del mapper de estados y del webhook | actualizar |
| OAuth, repositorio de cuentas, resolver, DTOs, UI (`card-payment-brick.tsx`) | sin cambio |

Riesgos a vigilar: estados intermedios (`action_required`, `processing`) que el
fallback actual cancelaria como rechazo; correlacion del webhook; pagos en vuelo
con eventos `payment` durante el corte (soportar ambos types o usar un flag);
sigue sin existir reconciliacion por cron para Mercado Pago (solo Transbank).

## Siguientes pasos propuestos

1. Crear la app "Sazono QA" (tipo Orders) y hacer un spike en sandbox: `POST /v1/orders` con token de vendedor OAuth, con y sin `application_fee`, ver como llega el webhook y la moneda CLP. Probar tambien si esa misma app acepta `POST /v1/payments`, para saber si el tipo de app restringe.
2. Preguntar a Mercado Pago (soporte o contacto comercial): fecha de descontinuacion de Payments API; si Orders soporta comision de plataforma con vendedores OAuth en Chile; si el webhook del panel recibe los eventos de vendedores conectados.
3. Si el spike confirma comision: migrar con un flag `MERCADOPAGO_API_MODE` (payments u orders) para convivir durante el corte.
4. Si no: mantener Payments API y decidir el modelo de monetizacion con esa restriccion en mente.

## Orders API (implementado detras de MERCADOPAGO_API_MODE)

### Que se implemento

- `MERCADOPAGO_API_MODE=payments|orders` (default `payments`). Con `payments` el camino de cobro es el de siempre; no se envia comision.
- Con `orders`, `MercadoPagoGatewayAdapter.charge()` llama `POST /v1/orders` (SDK `Order.create`) con `type=online`, `capture_mode=automatic`, `total_amount` y `payments[].amount` como string, `payment_method.type` (`credit_card` por defecto, o el `paymentTypeId` que entrega el Brick) e `idempotencyKey = attemptId`. `getPayment()` usa `Order.get`. Ante 409/423 se busca la order existente con `Order.search` por `external_reference` (ultimas 24 h).
- Estados de order (`mapMercadoPagoOrderStatus`): `processed` = APPROVED; `failed`, `canceled`, `expired` = REJECTED; `created`, `processing`, `action_required`, `refunded`, `charged_back` y desconocidos = PENDING. En `charge()` un PENDING se devuelve como `kind: 'PENDING'` con `providerReference` = id de la order (ver "Order no final" abajo). Una order no final sin id se rechaza porque no se puede conciliar.
- El webhook acepta `type` = `order` / `orders` ademas de `payment`; `scripts/mp-webhook-curl.mjs` acepta `order` como 4to argumento.
- UI y DTOs transportan `paymentTypeId` (opcional) desde el Brick hasta el adaptador.

### Como habilitarlo

1. `MERCADOPAGO_API_MODE=orders`.
2. `PAYMENTS_APPLICATION_FEE_BPS=100` (1%).
3. Reiniciar el backend. Para volver atras basta `MERCADOPAGO_API_MODE=payments`.

### Decision de comision (1%)

- Se envia como `marketplace_fee` (string, entero en CLP) = `floor(monto_sin_propina * bps / 10000)`; se omite si es 0. Ejemplo: 11800 CLP = 118.
- La propina NO paga comision: la base es `amount - tipAmount` (`ChargePaymentRequest.tipAmount`, informado por `pay-qr-order`, `pay-bill-split-participant` y `settle-bill-payment`).
- Solo aplica en modo `orders`. En modo `payments` `PAYMENTS_APPLICATION_FEE_BPS` sigue sin cobrarse (no se cablea `application_fee` en Payments).

### Sin verificar (requiere el spike en sandbox)

- Que un access token OAuth de vendedor sea aceptado en `POST /v1/orders`.
- Que `marketplace_fee` sea aceptada en el flujo de tarjeta directa (la doc la menciona solo para Checkout Pro via Orders) y que el monto se acredite a Sazono.
- Entrega de webhooks de orders para vendedores conectados, los valores reales de `type`/`action` y si la firma usa el mismo manifest que Payments.
- Requisitos de moneda CLP (entero como string) y de `payment_method.type` (debito/prepago segun el Brick); el codigo del error 409/423 y su forma en el SDK.
- `refunded` / `charged_back` no revierten nada (el webhook solo registra el estado).


### Order no final (sin binary_mode)

- El adapter devuelve `PENDING`; `ChargePaymentService` lo propaga y los servicios que cobran (`settle-bill-payment`, `pay-qr-order`, `pay-bill-split-participant`) dejan el `PaymentAttempt` en PENDING con `provider=MERCADO_PAGO`, `providerReference` y `tipAmount` (y el participante en el split), no acreditan la cuenta ni rutean la orden, y responden 409 "El pago esta en revision..." (la UI ya muestra el mensaje del error). El `tipAmount` (y el participante en el split) se guardan al crear el intento, antes de cobrar. Mientras haya un intento MP PENDING en la misma cuenta (`billId`), no se acepta un nuevo cobro (evita doble cobro; riesgo resuelto para este camino). El 409 lleva `code: 'PAYMENT_IN_REVIEW'`: la UI de tarjeta (`use-card-checkout-payment`) lo trata como "verificando" y consulta el estado de la orden/cuenta durante 30 s; si sigue pendiente muestra el aviso existente de "no se pudo verificar".
- Webhook `order`/`orders` con `processed` sobre un intento PENDING: finaliza una sola vez (pago, credito de cuenta, ruteo de orden o split) via `ConfirmRedirectPaymentService.applySnapshotOutcome`. `failed`/`canceled`/`expired`: el intento pasa a FAILED y la orden a PAYMENT_FAILED. `refunded`/`charged_back` solo se registran y se loguean; nunca se reversan ni acreditan automaticamente. En modo `payments` el webhook conserva su comportamiento anterior.
- Red de seguridad: `ReconcileMercadoPagoPaymentsScheduler` (solo con `MERCADOPAGO_API_MODE=orders`) consulta `Order.get` de los intentos MP PENDING con mas de `MERCADOPAGO_RECONCILIATION_MIN_AGE_MINUTES` (5) cada `MERCADOPAGO_RECONCILIATION_INTERVAL_MS` (5 min) y los finaliza o rechaza. Si Mercado Pago no responde, el intento sigue PENDING (no se rechaza). Un `Order.create` ambiguo (timeout, sin status HTTP, 5xx, 408/409/423) primero busca la order por `external_reference`; si no la encuentra queda PENDING sin referencia y el reconciliador la busca por id de intento (se rechaza tras 2 h sin hallazgo). Todo intento aun PENDING tras 48 h se rechaza (orden a PAYMENT_FAILED) con un `logger.error` para revision manual en Mercado Pago.
- Limite conocido: un intento que quede PENDING con la order `refunded`/`charged_back` nunca se resuelve solo y bloquea nuevos cobros sobre esa orden/cuenta/participante hasta revision manual (o hasta el tope de 48 h si la order sigue en estado no final).
- Otros limites: un pago offline que sobrepague la cuenta mientras hay un intento PENDING impide finalizarlo (se rechaza al tope de 48 h aunque se haya cobrado); si falla el update de `providerReference` tras crear la order, el intento queda MANUAL sin referencia y solo lo resuelve un webhook por `external_reference`; el boton de pago no-tarjeta (`bill-pay-sheet`) muestra un error generico.