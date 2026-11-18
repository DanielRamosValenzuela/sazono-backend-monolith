# 38. Descuentos (M8a): contrato

Implementa el hito M8a del diseno `docs/38-diseno-m8-descuentos-arqueo-reembolso-por-item.md` del repositorio raiz. Migracion: `20261123120000_discounts`.

## Formula

```
S = bills.subtotal_amount            suma de bill_items OPEN, bruta
D = bills.discount_amount            descuento de lineas + descuento de cuenta
C = S - D                            consumo cobrable (IVA incluido)
total     = C + tip + tax(0)
remaining = total - pagado           pagado = total_anterior - remaining_anterior
```

- `computeBillTotals(subtotal, tip, discount = 0)` en `billing/domain/tax-policy.ts` devuelve `taxAmount`, `discountAmount` (recortado a `[0, S]`), `consumptionAmount` y `totalAmount`.
- `computeDiscounts` en `billing/domain/discount-policy.ts`: `PERCENT` se redondea HALF_UP una vez sobre la base; el descuento de cuenta se reparte entre lineas por mayor resto y se guarda en `bill_items.discount_amount`.
- `PERCENT` es vivo: `refreshBillDiscounts` lo recalcula al agregar o anular items (`applyOrderChargeToBill`, `cancelInProductionOrder`). Un descuento de linea cuya linea queda VOID se anula solo (`void_reason = LINE_VOIDED`, auditoria `DISCOUNT_RECALCULATED`).
- Todos los servicios que escriben totales (`applyOrderChargeToBill`, `cancelInProductionOrder`, `applyPaymentToBill`, descuentos) toman `lockBill` (`SELECT ... FOR UPDATE`) como primera sentencia de la transaccion. `applyOrderChargeToBill` relee la cuenta despues del bloqueo.
- `settleBillIfFullyPaid` (payments) cierra ordenes READY y la sesion cuando el saldo llega a 0 con pagos.

## Endpoints (`/v1`, STAFF, `fresh: true`)

| Metodo y ruta | Roles | Notas |
|---|---|---|
| `POST /branches/:branchId/bills/:billId/discounts` | ADMIN, SUPERVISOR, CASHIER | Header `Idempotency-Key` (8-100, `[A-Za-z0-9._:-]`) obligatorio. 201. Throttle 20/min. |
| `POST .../discounts/preview` | idem | No persiste. |
| `POST .../discounts/:discountId/void` | idem | ADMIN/SUPERVISOR cualquiera. CASHIER solo uno propio sin aprobador. |
| `GET .../discounts` | idem | Incluye anulados y los umbrales de la sucursal. |
| `GET /reports/branches/:branchId/discounts` | ADMIN, SUPERVISOR, CASHIER (solo lo suyo de hoy) | Query `from`, `to`, `cashierId`, `reasonCode`, `voided`. Maximo 500 filas (`truncated`). |

Body de crear / previsualizar:

```json
{
  "billItemId": "uuid opcional (sin el, descuento de cuenta)",
  "type": "PERCENT | AMOUNT",
  "value": "10",
  "reasonCode": "COURTESY | CUSTOMER_COMPLAINT | STAFF_MEAL | PROMOTION | LOYALTY | PRICE_ERROR | OTHER",
  "reasonText": "minimo 3 caracteres",
  "approverStaffUserId": "uuid (con PIN)",
  "approverPin": "4 a 6 digitos"
}
```

Respuesta de crear: `{ discount, bill, splitCancelled, idempotentReplay }`. `bill` trae `subtotalAmount`, `discountAmount`, `consumptionAmount`, `tipAmount`, `totalAmount`, `paidAmount`, `remainingAmount`, `status`. Preview: `{ bill, newDiscountAmount, needsApproval, maxDiscount, approvers }`.

Errores con `code`: `DISCOUNT_BILL_NOT_PAYABLE`, `DISCOUNT_BILL_HAS_REFUNDS`, `DISCOUNT_BILL_HAS_ACTIVE_SPLIT`, `DISCOUNT_PAYMENT_IN_PROGRESS`, `DISCOUNT_EXCEEDS_REMAINING` (con `maxDiscount`), `DISCOUNT_ALREADY_ACTIVE`, `DISCOUNT_NEEDS_APPROVAL` (con `approvers`), `DISCOUNT_APPROVER_INVALID`, `DISCOUNT_PIN_INVALID`, `DISCOUNT_PIN_LOCKED`, `DISCOUNT_APPROVAL_BLOCKED`, `DISCOUNT_IDEMPOTENCY_KEY_REUSED`, `DISCOUNT_IDEMPOTENCY_KEY_REQUIRED`, `DISCOUNT_IDEMPOTENCY_KEY_INVALID`, `DISCOUNT_VALUE_INVALID`, `DISCOUNT_NO_EFFECT`, `DISCOUNT_ITEM_NOT_FOUND`, `DISCOUNT_NOT_FOUND`, `DISCOUNT_ALREADY_VOIDED`, `DISCOUNT_VOID_FORBIDDEN`.

## Aprobacion

- Roles ADMIN no necesitan PIN. Para el resto, el descuento acumulado de la cuenta exige PIN de un ADMIN distinto del actor si supera `BranchSettings.discountApprovalPercent` (default 10 %, null = sin umbral) o `discountApprovalAmount` (null = sin umbral), o si deja el consumo en 0 (cortesia total, siempre).
- Servicio compartido `common/approval/approval-pin.service.ts` (`listApprovers`, `verify`). El bloqueo cuenta cualquier accion `*_APPROVAL_FAILED` del actor (5 en 15 minutos); es el control principal contra fuerza bruta. El bloqueo global del PIN del aprobador solo se activa tras 20 fallos acumulados de todos los actores (`APPROVAL_PIN_GLOBAL_MAX_FAILED_ATTEMPTS`, 15 minutos), asi un solo cajero no puede bloquear al aprobador para los demas. Los intentos rechazados por aprobador bloqueado (`DISCOUNT_PIN_LOCKED`) no escriben fila `*_APPROVAL_FAILED`. `RefundPaymentService` conserva su propia implementacion (sin cambios de comportamiento); migrarlo al servicio compartido queda pendiente.
- Configuracion: `PATCH /branches/:branchId` con `settings.discountApprovalPercent` (0-100, 2 decimales, null) y `settings.discountApprovalAmount` (entero >= 0, null). Auditoria `BRANCH_DISCOUNT_SETTINGS_CHANGED`. La respuesta de sucursales expone ambos como string o null.

## Reglas de estado

- Un descuento AMOUNT sobre una linea no puede superar el total de la linea: 400 `DISCOUNT_VALUE_INVALID`.
- Solo cuentas OPEN o PARTIALLY_PAID. Con `refunded_amount > 0`: 409.
- Tope: `D <= S + T - pagado`. Si el saldo llega a 0 la cuenta pasa a PAID y corre `settleBillIfFullyPaid`; esto incluye la cortesia total sin pagos (cuenta PAID y sesion PAYMENT_COMPLETED).
- Una cuenta con intento de pago PENDING de los ultimos 15 minutos no acepta descuentos nuevos.
- Split activo con pagos: 409. Split activo sin pagos: se cancela (`DISCOUNT_SPLIT_CANCELLED`, `splitCancelled: true`).
- Un descuento activo por cuenta y uno por linea (indices parciales unicos de la migracion).

## Auditoria

`DISCOUNT_APPLIED`, `DISCOUNT_APPROVED`, `DISCOUNT_DENIED`, `DISCOUNT_APPROVAL_FAILED`, `DISCOUNT_VOIDED`, `DISCOUNT_RECALCULATED`, `DISCOUNT_SPLIT_CANCELLED`, `BRANCH_DISCOUNT_SETTINGS_CHANGED`.

## Reportes

- Ventas, medios, cajeros, horas y KPIs salen de `payments` y ya son netos de descuento. El descuento nunca se resta de nuevo.
- Ventas por orden: `discounts = bills.discount_amount` solo con cuenta PAID, `payable` = consumo cobrado, `total = payable + discounts`.
- Jerarquia: resta `bill_items.discount_amount` por linea (la parte de reembolso por item es M8c). Sigue contando las lineas completas de cuentas parciales o abandonadas (no se reparte lo cobrado como en el Z), por lo que puede superar el total de ventas; es una vista de producto, no de conciliacion.
- Z diario: `sales.discounts`, `discountCount`, `discountsByReason`, `discountsByApprover`; `byCategory` se reparte sobre lo cobrado y cuadra con `sales.total`.
- Cuentas abiertas: columna `discount`.
- Detalle de orden: `items[].discount`, `discounts[]`, `totals.discount`, `totals.consumption`; `reconciled` compara `items - descuento` contra lo pagado.
- Estado de cuenta de plataforma: `discounts` es informativo (suma de descuentos de cuentas PAID cerradas en el mes, incluidas las cortesias sin pagos, fechadas por `updated_at` igual que el Z). `computeFee` ya no lo resta (`netSales = gross - refunds + carryOverIn`). Estados ISSUED no cambian.
- Cuentas y QR (`current-bill`, `open-bills`, `qr bill`, resultado de pago, sesiones de mostrador) exponen `discountAmount` y, donde aplica, `consumptionAmount`.

## No incluido

- `analytics/` (modulo obsoleto reemplazado por `reports`) no resta descuentos.
- El bloqueo de anular lineas con `refunded_quantity > 0` pertenece a M8c.
- Cursor keyset del reporte de descuentos: hoy limite fijo de 500 filas.
