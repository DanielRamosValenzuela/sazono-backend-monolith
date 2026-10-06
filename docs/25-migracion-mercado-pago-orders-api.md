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
