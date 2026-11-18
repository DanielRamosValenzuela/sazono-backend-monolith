# Reembolsos por pasarela (M6)

Reembolsos reales contra Mercado Pago y Transbank Webpay Mall, con conciliación. Complementa `docs/32-reembolsos.md` y la sección 5 de `docs/11-spec-reporteria-y-reembolsos.md`. No hay cambios de schema ni de migración: usa `Refund`, `Payment.disputed` y las migraciones ya escritas.

## Puerto

`PaymentGatewayPort` extiende con `refund?(context)` y `getRefundState?(context)` (`PaymentGatewayRefundPort`).

- `refund` devuelve `REFUNDED`, `PENDING`, `REJECTED` (`retryable`, `failureReason`, `code`) o `AMBIGUOUS`.
- `getRefundState` devuelve `REFUNDED`, `PENDING`, `NOT_REFUNDED` o `UNKNOWN`, comparando contra lo ya reembolsado (suma de `SUCCEEDED` del pago sin contar el actual).
- El contexto lleva `idempotencyKey` (`refund.id`, o `refund.id-rN` tras N reintentos manuales), `paymentAmount`, `alreadyRefundedAmount`, `gatewayMeta` y las credenciales resueltas por `PaymentGatewayResolverService`.
- `GatewayPaymentSnapshot` suma `refunds[]` y `chargedBack` para el webhook.

## Mercado Pago

- Modo Orders (`MERCADOPAGO_API_MODE=orders`): reembolso total (sin reembolsos previos y monto igual al pago) = `Order.refund({id})` sin body; parcial = `body.transactions=[{id: gatewayMeta.transactionId, amount}]`, y si falta el id se resuelve con `Order.get` justo antes. Siempre `requestOptions.idempotencyKey`.
- Modo Payments: `PaymentRefund.total` / `PaymentRefund.create({amount})` con la misma clave.
- 4xx = `REJECTED` (401/403 sugiere reconectar la cuenta; 429 es reintentable); 5xx, 408, 409, 423, timeouts y errores de red = `AMBIGUOUS`.
- Sin saldo o cuenta desconectada/pausada: el reembolso termina `FAILED` con motivo en español que sugiere registrarlo como manual.

## Transbank Webpay Mall

- `MallTransaction.refund(token, buy_order hijo, childCommerceCode, monto entero)`. `REVERSED` y `NULLIFIED` con `response_code` 0 se tratan como `REFUNDED`; el tipo y el `balance` quedan en `providerRaw`. La anulación puede tardar días hábiles en reflejarse (la UI lo avisa).
- Sin idempotency key: tras timeout o error de red NUNCA se reintenta; se consulta `status(token)` y se compara el `balance` del detalle hijo con el balance esperado (monto del pago menos reembolsos `SUCCEEDED` previos). Bajó exactamente el monto: `REFUNDED`. Igual o distinto: `AMBIGUOUS` (lo resuelve el reconciliador).
- Pagos en cuotas (`installments > 1`): solo se permite el reembolso total; el parcial se rechaza sin llamar a Transbank con un mensaje claro y el ADMIN puede usar `registerAsManual`.
- Los mensajes no dependen de códigos de error no verificados (53, 284, 311): el mensaje de Transbank queda solo en `providerRaw`. Confirmarlos en sandbox antes de fijar textos específicos.

## Contratos

- `POST /v1/branches/:branchId/payments/:paymentId/refunds` (header `Idempotency-Key`): body igual que M4 más `registerAsManual?: boolean` (solo ADMIN). Respuesta `RefundResultResponseDto`; `refund.status` es `PENDING` mientras la pasarela no confirma, `FAILED` con `refund.failureReason` si rechazó.
- `GET /v1/branches/:branchId/payments/:paymentId/refunds`: suma `payment.disputed`, `payment.installments`, `payment.gatewayRefundSupported` y `eligibility.canManageGateway`; cada refund suma `failureReason`. La UI sondea este endpoint cada 3 s mientras hay un reembolso `PENDING`.
- `POST /v1/refunds/:id/retry` (ADMIN): desde `FAILED` re-reserva el saldo (409 `REFUND_CONFLICT` si ya no alcanza), vuelve a `PENDING` y llama a la pasarela con una clave nueva. Desde `REQUIRES_MANUAL_REVIEW` o `PENDING` con más de 2 minutos primero consulta el estado a la pasarela: si ya estaba reembolsado lo cierra; si no hay rastro lo libera y reintenta; si sigue desconocido responde 409 `REFUND_NOT_ACTIONABLE`.
- `POST /v1/refunds/:id/mark-manual` (ADMIN): convierte en `MANUAL_EXTERNAL` `SUCCEEDED` desde `FAILED` (re-reserva), `REQUIRES_MANUAL_REVIEW` o `PENDING` con más de 2 minutos (conserva la reserva). Auditoría `REFUND_REGISTERED_MANUAL`. Advertencia: si la pasarela termina reembolsando igual, el dinero se devolvería dos veces; úsalo solo si ya se devolvió por otra vía.
- Ambos responden `RefundResultResponseDto`; 404 `REFUND_NOT_FOUND`, 409 `REFUND_NOT_GATEWAY` / `REFUND_NOT_ACTIONABLE`.

## Conciliación

`ReconcileGatewayRefundsService` + `ReconcileGatewayRefundsScheduler` revisan reembolsos `GATEWAY` `PENDING` de más de 2 minutos (lote de 100) llamando a `getRefundState`: `REFUNDED` cierra como `SUCCEEDED`; `NOT_REFUNDED` pasa a `FAILED` y libera la reserva (cubre también un proceso caído antes de llamar a la pasarela); `PENDING` o `UNKNOWN` cuentan un intento (`providerRaw.reconcileAttempts`). Tras 10 intentos o 48 horas pasa a `REQUIRES_MANUAL_REVIEW` conservando la reserva, con auditoría.

Variables de entorno (todas opcionales): `REFUND_RECONCILIATION_ENABLED` (true), `REFUND_RECONCILIATION_INTERVAL_MS` (120000), `REFUND_RECONCILIATION_MIN_AGE_MINUTES` (2), `REFUND_RECONCILIATION_MAX_ATTEMPTS` (10), `REFUND_RECONCILIATION_MAX_AGE_HOURS` (48). El job nunca corre con `NODE_ENV=test`.

## Webhook de Mercado Pago

`HandleMercadoPagoWebhookService` delega en `ReconcileMercadoPagoRefundsService` (ya no solo `logger.warn`), conservando firma e idempotencia de eventos:

- Reembolso propio pendiente: se concilia por `providerRefundReference` o, si aún no se guardó, por monto exacto.
- Reembolso externo (hecho en el panel de Mercado Pago): se crea un `Refund` con `source='WEBHOOK'`, `method=GATEWAY`, `SUCCEEDED`, motivo `OTHER` y texto "Reembolso realizado desde el panel de Mercado Pago". La propina se asigna solo cuando el monto supera el consumo restante. Mismo `UPDATE` condicional que M4; si excede el saldo, se omite con log y auditoría `REFUND_EXTERNAL_SKIPPED`.
- Idempotente: clave `mp-refund-<id>` más el único `(provider, providerRefundReference)`; duplicados y webhooks fuera de orden no cuentan dos veces (cada webhook reprocesa la lista completa de reembolsos de la orden).
- `charged_back` o `chargebacks`: `Payment.disputed = true` y auditoría `PAYMENT_DISPUTED`; no se crea reembolso.

## Supuestos y límites

- "Ya reembolsado" para el balance de la pasarela suma los reembolsos `SUCCEEDED` de cualquier método del pago.
- Dos reembolsos de pasarela simultáneos sobre el mismo pago Transbank pueden dar `AMBIGUOUS` y terminar en revisión manual.
- La conciliación de un `NOT_REFUNDED` tras un timeout de Transbank asume que la operación en vuelo ya terminó pasados 2 minutos.
- El aviso a ADMIN por contracargo queda solo en auditoría y en la insignia "Contracargo" del diálogo; no hay notificación push.
