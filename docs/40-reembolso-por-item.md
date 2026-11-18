# 40. Reembolso por producto (M8c)

Diseno: `docs/38-diseno-m8-descuentos-arqueo-reembolso-por-item.md` (secciones 3, 6.3, 7, 9.3). Migracion: `20261125120000_refund_items`.

## Que hace

Devuelve plata de un pago eligiendo lineas de la cuenta y cantidades. El servidor calcula el monto; el cliente nunca lo manda. Reutiliza el motor de `RefundPaymentService` (M4 efectivo/manual, M6 pasarela PENDING -> llamada fuera de la transaccion -> final), asi que metodo de reembolso, tope diario del cajero con PIN de ADMIN, auditoria e idempotencia son los mismos.

## Endpoints

Prefijo `/v1/branches/:branchId/bills/:billId/refunds`. Roles ADMIN y CASHIER (`fresh: true` al registrar).

| Metodo y ruta | Uso |
|---|---|
| `GET items` | Lineas OPEN con `quantity`, `refundedQuantity`, `availableQuantity`, `unitRefundAmount`, `netAmount`, `refundedAmount`. |
| `POST items/preview` | `{ paymentId, items: [{ billItemId, quantity }], refundTip? }` -> lineas con monto, `consumptionAmount`, `tipAmount`, `total` y estado reembolsable del pago. No persiste. |
| `POST items` | `{ paymentId, items: [{ billItemId, quantity, kitchenWaste? }], reasonCode, reasonText, refundTip?, registerAsManual?, approverStaffUserId?, approverPin? }` + header `Idempotency-Key`. Misma respuesta que `POST /payments/:paymentId/refunds`; `refund.items` trae el detalle. |
| `GET /v1/reports/branches/:branchId/waste?from&to` | Merma (items con `kitchenWaste`) por producto y estacion. ADMIN y SUPERVISOR. |

`GET /payments/:paymentId/refunds` y toda respuesta con `refund` incluyen ahora `items: [{ billItemId, name, quantity, amount, kitchenWaste }]` (vacio en reembolsos por monto).

## Calculo

Por linea con `quantity n`, `net = total_price - discount_amount` (neto del descuento de M8a):

- Si `refundedQuantity + k < n`: `round_half_up(net * k / n)`, tope lo que queda de la linea.
- Si es la ultima unidad pendiente: `net - suma de RefundItem.amount previos` (cierra sin pesos sueltos).

`consumo = suma de lineas`. Con `refundTip = true` la propina es `consumo * tip_pago / consumo_pago` (HALF_UP, tope propina reembolsable). `Refund.amount = consumo + propina`.

## Reglas

- Un solo pago por solicitud. Si el consumo supera lo reembolsable del pago: 409 `REFUND_ITEMS_EXCEED_PAYMENT` con el saldo.
- `409 REFUND_ITEM_QUANTITY_EXCEEDED` (unidades), `404 BILL_ITEM_NOT_FOUND`, `400 REFUND_ITEMS_DUPLICATED`, `404 PAYMENT_NOT_FOUND` (el pago no es de esa cuenta).
- Guardia de concurrencia: `UPDATE bill_items SET refunded_quantity = refunded_quantity + k WHERE refunded_quantity = <leido> AND refunded_quantity + k <= quantity`; 0 filas -> 409 `REFUND_ITEMS_CONFLICT` y la transaccion (incluido el pago) se revierte.
- No cambia `bills.total/remaining/subtotal` ni el estado de la linea. Solo `bills.refunded_amount` y `payments.refunded_*`.
- Reembolso de pasarela fallido: `release` devuelve `refunded_quantity`; reintento (`reserve`) lo vuelve a tomar con guardia.
- Anular una orden con lineas reembolsadas: 409 `ORDER_HAS_REFUNDED_ITEMS`.
- Idempotencia: la huella incluye las lineas (`billItemId:cantidad:merma`); el replay se resuelve antes de planificar, asi que repetir la misma llamada devuelve el resultado original.
- `RefundItem` guarda snapshot de nombre, ruta de categoria y estacion.

## Reportes

- Jerarquia: se agregan filas negativas por `(categoria, producto, estacion)` con los `refund_items` de reembolsos SUCCEEDED cuyo `completed_at` cae en el rango (mismos filtros que `periodRefundsSql`). La fila "REEMBOLSOS (no asignados a productos)" ahora suma solo los reembolsos sin detalle por producto (`amount - sum(refund_items.amount)`), para que `suma jerarquia = ventas netas`. Las categorias del Z (`byCategory`) usan solo lineas vendidas y cuadran con las ventas; no incluyen los negativos de reembolsos por item.
- Merma: ver endpoint `waste`.

## No hecho / supuestos

- Los reembolsos creados desde webhooks de pasarela (conciliacion) no traen items.
- El servicio compartido `ApprovalPinService` no se uso aqui: el PIN sigue por el camino M4 (`REFUND_NEEDS_APPROVAL`, `REFUND_PIN_INVALID`).
- Pruebas contra QA/SQL real no ejecutadas (solo mocks).
