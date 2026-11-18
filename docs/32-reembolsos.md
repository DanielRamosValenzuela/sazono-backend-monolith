# 32. Reembolsos (M4): contrato de API, reglas y efectos en los reportes

Cuarto hito de la reportería (`docs/11-spec-reporteria-y-reembolsos.md` del repositorio raíz; diseño final en `docs/32-diseno-m4-reembolsos.md` del repositorio raíz). Agrega reembolsos totales y parciales de pagos cobrados, el movimiento de caja del efectivo devuelto, la auditoría inmutable y la resta de los reembolsos en todos los reportes.

Qué NO hace: no llama a ninguna pasarela (el reembolso real por Mercado Pago o Transbank es el hito M6), no emite nota de crédito (queda `creditNoteStatus = PENDING`), no anula órdenes ni avisa a cocina, no cambia `Bill.status`, `Bill.totalAmount`, `Bill.remainingAmount` ni `Payment.status`.

Dinero: pesos chilenos como string en JSON (`"3000"`; los montos que se envían en reembolsos son pesos enteros). Fechas de reportes: hora del restaurante (`America/Santiago` por defecto), rangos semiabiertos.

## Reglas de negocio

| Tema | Regla |
| --- | --- |
| Quién | `ADMIN` y `CASHIER` registran. `SUPERVISOR` solo lee (`GET`). `WAITER`, `KITCHEN`, `BAR`: 403. |
| Qué pagos | Cualquier `Payment` con `status = PAID`, sin importar el estado de la cuenta (`OPEN`, `PARTIALLY_PAID`, `PAID`, `ABANDONED`, `VOID`). |
| Efectivo | `provider = MANUAL` y `method = CASH`: método `CASH_MANUAL`, nace `SUCCEEDED` y crea un `CashMovement` `REFUND_OUT` con monto negativo igual al total devuelto (consumo más propina). ADMIN y CASHIER. |
| Resto de pagos | Tarjeta, transferencia, vale, MACH, otro, pagos históricos sin medio, Mercado Pago y Transbank: método `MANUAL_EXTERNAL`, solo `ADMIN`, sin `CashMovement`. Sazono solo registra: el dinero lo devolvió el administrador fuera de Sazono. |
| Alcance del cajero | Solo pagos en efectivo cobrados hoy (hora del restaurante). Ve únicamente los reembolsos que él registró (en `GET`, en el detalle de comanda y en el reporte). |
| Motivo | `reasonCode` obligatorio y `reasonText` obligatorio (3 a 500 caracteres tras recortar espacios). |
| Parciales | Sí, acumulables hasta agotar el consumo y la propina del pago. |
| Propina | No se devuelve salvo `refundTip = true` (o `branch_settings.refund_tip_default`). Sin `tipAmount` se calcula proporcional a lo que queda por devolver, `round(amount * refundable.tip / refundable.total)`, ajustada hacia arriba si el consumo no cabe; con `amount == refundable.total` es la propina restante exacta. `tipAmount` explícito la reemplaza (nunca mayor a la propina restante ni al monto). |
| Comisión de Sazono | Sin comisión por transacción: no hay nada que devolver. El 1% mensual resta el consumo reembolsado en el mes del reembolso (hito M5). |
| Nota de crédito | Se guarda `netAmount`, `vatAmount` (acumulados: la suma de todos los reembolsos da el neto del consumo devuelto, `N(x) = round(x / 1,19)`) y `creditNoteStatus` (`PENDING`, o `NOT_REQUIRED` si el reembolso es solo propina). No se emite ningún documento. |
| Tope diario del cajero | `branch_settings.cashier_refund_limit` (null = sin tope, valor por defecto; máximo 9999999999). Se acumula por cajero y por día local: suma de sus reembolsos del día sin aprobación más el monto pedido. La verificación se repite dentro de la transacción tras tomar `pg_advisory_xact_lock(hashtext('refund-limit:' || cajero || ':' || sucursal))`, de modo que reembolsos paralelos del mismo cajero se serializan y ninguno se cuela bajo el tope; si el recuento bajo el candado supera el tope y no hay aprobación, responde igual 403 `REFUND_NEEDS_APPROVAL`. Sobre el tope: 403 `REFUND_NEEDS_APPROVAL` y se reintenta con `approverStaffUserId` + `approverPin` de un ADMIN activo de la sucursal con PIN. |
| PIN del aprobador | Contadores propios (`staff_users.approval_pin_*`), distintos de los del login. Cada intento reserva su lugar antes de comparar el PIN con un `UPDATE` condicional atómico (suma el intento y bloquea al llegar al límite; no actualiza filas ya bloqueadas), así una ráfaga paralela prueba como máximo 5 PIN y el resto recibe `REFUND_PIN_LOCKED` (lo mismo vale para el login con PIN): el bloqueo global del aprobador solo se activa tras 20 intentos fallidos acumulados entre todos los solicitantes (constante `APPROVAL_PIN_GLOBAL_MAX_FAILED_ATTEMPTS`), bloquea la aprobación 15 minutos y no afecta el ingreso del ADMIN con PIN; el control principal contra fuerza bruta es el límite por solicitante (abajo), de modo que un solo cajero, bloqueado tras 5, no puede bloquear al aprobador para los demás. Los intentos rechazados porque el aprobador está bloqueado (`REFUND_PIN_LOCKED`) o el solicitante está bloqueado no escriben fila de auditoría y no suman al límite de otros usuarios. Un solicitante con 5 aprobaciones fallidas en 15 minutos recibe `REFUND_APPROVAL_BLOCKED`. El módulo nunca devuelve 401 por un PIN malo. |
| Concurrencia | `UPDATE` condicional atómico sobre el pago (3 desigualdades: total, propina y consumo) y `CHECK` equivalentes en la base. Dos solicitudes por el último saldo: una gana y la otra recibe `REFUND_CONFLICT`. |
| Idempotencia | Header `Idempotency-Key` obligatorio, único por `(paymentId, key)`. Misma clave, mismo solicitante y mismo cuerpo (monto, propina resuelta, motivo y detalle) devuelve el mismo reembolso con `idempotentReplay: true`; si no, 409. La reproducción se evalúa antes de resolver el modo (efectivo del día, solo ADMIN), por lo que un reintento con la misma clave sigue devolviendo el reembolso ya registrado aunque la elegibilidad del cajero haya caducado (cambio de día o de rol); sigue exigiendo rol vigente en la sucursal, mismo solicitante y mismo cuerpo. |
| Anular una orden pagada | `cancel-order` sigue devolviendo 409, ahora con `code: 'REFUND_REQUIRED'` y `billId`. Reembolsar no anula la orden ni avisa a cocina: la respuesta trae `billActiveOrders` y el reporte `billHasActiveOrders`. |

## Endpoints

Prefijo global `/api`. Todos exigen `Authorization: Bearer <accessToken>` de un perfil `STAFF`.

### `POST /api/v1/branches/:branchId/payments/:paymentId/refunds`

Headers: `Idempotency-Key: <8 a 100 caracteres [A-Za-z0-9._:-]>` (obligatorio), `Content-Type: application/json`. Throttle: 20 por minuto.

Cuerpo:

```json
{
  "amount": "3000",
  "reasonCode": "CUSTOMER_COMPLAINT",
  "reasonText": "Plato frio",
  "refundTip": false,
  "tipAmount": "500",
  "approverStaffUserId": "uuid",
  "approverPin": "1234"
}
```

| Campo | Tipo | Regla |
| --- | --- | --- |
| `amount` | string | Obligatorio. Pesos enteros (`^(0\|[1-9]\d{0,9})$`; un decimal da 400). Total devuelto al cliente incluida la propina que se devuelva. Cero da `REFUND_AMOUNT_INVALID`. |
| `reasonCode` | enum | Obligatorio: `CUSTOMER_COMPLAINT`, `WRONG_ORDER`, `DISH_UNAVAILABLE`, `QUALITY_ISSUE`, `DUPLICATE_CHARGE`, `CASHIER_ERROR`, `OTHER`. |
| `reasonText` | string | Obligatorio, 3 a 500 caracteres tras recortar, con al menos 3 caracteres visibles (los de ancho cero no cuentan) y sin caracteres de control (NUL incluido): si no, 400. |
| `refundTip` | boolean | Opcional. Si falta se usa `refundTipDefault` de la sucursal. Debe ser boolean JSON (un string da 400). |
| `tipAmount` | string | Opcional, propina incluida en `amount`. Solo con `refundTip = true`. |
| `approverStaffUserId`, `approverPin` | uuid, 4 a 6 dígitos | Opcionales pero van juntos. Solo se usan si el CASHIER supera el tope diario; un ADMIN los ignora. |

Respuesta `201`:

```json
{
  "refund": {
    "refundId": "uuid",
    "paymentId": "uuid",
    "billId": "uuid",
    "amount": "3000",
    "tipAmount": "0",
    "consumptionAmount": "3000",
    "netAmount": "2521",
    "vatAmount": "479",
    "status": "SUCCEEDED",
    "method": "CASH_MANUAL",
    "reasonCode": "CUSTOMER_COMPLAINT",
    "reasonText": "Plato frio",
    "requestedBy": { "staffUserId": "uuid", "name": "Caro Cajera", "role": "CASHIER" },
    "approvedBy": null,
    "creditNoteStatus": "PENDING",
    "completedAt": "2026-11-20T15:04:05.000Z",
    "createdAt": "2026-11-20T15:04:05.000Z"
  },
  "payment": {
    "paymentId": "uuid",
    "amount": "11000",
    "tipAmount": "1000",
    "refundedAmount": "3000",
    "refundedTipAmount": "0",
    "refundable": { "total": "8000", "consumption": "7000", "tip": "1000" }
  },
  "cashToHandOver": "3000",
  "billActiveOrders": 0,
  "idempotentReplay": false
}
```

`cashToHandOver` es el total en efectivo que el cajero entrega (`null` si el método no es `CASH_MANUAL`). `approvedBy` es `{ "staffUserId", "name" }` cuando hubo aprobación. `billActiveOrders` cuenta las órdenes de la cuenta en `CONFIRMED`, `ROUTED`, `IN_PREPARATION`, `PARTIALLY_READY` o `READY`: la UI debe avisar "La comanda sigue activa: avisa a cocina". Una reproducción idempotente también responde `201`.

Errores (cuerpo `{ "message", "code", ... }`):

| HTTP | `code` | Cuándo | Extra |
| --- | --- | --- | --- |
| 400 | `REFUND_IDEMPOTENCY_KEY_REQUIRED` | Falta el header | |
| 400 | `REFUND_IDEMPOTENCY_KEY_INVALID` | Formato o largo inválido | |
| 400 | (validación de DTO) | Monto, motivo, enum, PIN, par aprobador | `message` con detalle |
| 400 | `REFUND_AMOUNT_INVALID` | Monto cero | |
| 400 | `REFUND_EXCEEDS_REFUNDABLE` | Monto, propina o consumo exceden lo disponible | `refundable { total, consumption, tip }` |
| 400 | `REFUND_TIP_NOT_ALLOWED` | `tipAmount` sin `refundTip` | `refundable` |
| 403 | (sin código) | Rol sin permiso, otra sucursal o usuario inactivo | |
| 403 | `REFUND_ADMIN_ONLY` | CASHIER sobre un pago que no es efectivo | |
| 403 | `REFUND_CASHIER_DAY_LIMIT` | CASHIER sobre efectivo cobrado otro día | |
| 403 | `REFUND_NEEDS_APPROVAL` | CASHIER supera el tope diario | `limit`, `dayRefunded`, `requiredTotal`, `approvers: [{ staffUserId, name }]` |
| 403 | `REFUND_APPROVAL_BLOCKED` | 5 aprobaciones fallidas del solicitante en 15 minutos | |
| 403 | `REFUND_APPROVER_INVALID` | Aprobador inexistente, no ADMIN activo, sin PIN o el mismo solicitante | |
| 403 | `REFUND_PIN_INVALID` | PIN incorrecto | |
| 403 | `REFUND_PIN_LOCKED` | PIN del aprobador bloqueado | |
| 404 | `PAYMENT_NOT_FOUND` | El pago no existe en la sucursal | |
| 409 | `REFUND_PAYMENT_NOT_PAID` | El pago no está `PAID` | |
| 409 | `REFUND_IDEMPOTENCY_KEY_REUSED` | Clave usada con otro cuerpo u otro solicitante | |
| 409 | `REFUND_CONFLICT` | El saldo cambió entre la lectura y el cobro; recargar | |

Auditoría (`audit_logs`, solo inserción): `REFUND_SUCCEEDED` (efectivo), `REFUND_REGISTERED_MANUAL` (`MANUAL_EXTERNAL`), `REFUND_APPROVED`, `REFUND_APPROVAL_FAILED` (actor = solicitante, entidad = aprobador, nunca el PIN) y `REFUND_DENIED` (`REFUND_ADMIN_ONLY`, `REFUND_CASHIER_DAY_LIMIT`, `REFUND_NEEDS_APPROVAL`) y `BRANCH_REFUND_SETTINGS_CHANGED` (cambio de `cashierRefundLimit` o `refundTipDefault`, con `before` y `after`, entidad `BranchSettings`). Incluyen `ip` (la dirección del socket, o la que resuelve `trust proxy`; el encabezado `X-Forwarded-For` enviado por el cliente se ignora a menos que `TRUST_PROXY_HOPS` lo habilite) y `user_agent` informativos, el estado de las órdenes de la cuenta y los acumulados del pago y de la cuenta.

### `GET /api/v1/branches/:branchId/payments/:paymentId/refunds`

Roles `ADMIN`, `SUPERVISOR`, `CASHIER`. Un CASHIER solo puede consultar pagos que él cobró hoy (hora del restaurante), igual que el detalle de comanda: cualquier otro pago (de otro cajero, de otro día o en línea) responde 404 `PAYMENT_NOT_FOUND`. Ve solo los reembolsos que él registró en `refunds[]`; `refundedAmount` y `refundable` reflejan todos.

```json
{
  "payment": {
    "paymentId": "uuid",
    "billId": "uuid",
    "method": "CASH",
    "provider": "MANUAL",
    "status": "PAID",
    "amount": "11000",
    "tipAmount": "1000",
    "consumptionAmount": "10000",
    "refundedAmount": "0",
    "refundedTipAmount": "0",
    "refundable": { "total": "11000", "consumption": "10000", "tip": "1000" },
    "paidAt": "2026-11-20T14:00:00.000Z"
  },
  "settings": { "cashierRefundLimit": null, "refundTipDefault": false },
  "eligibility": { "allowed": true, "method": "CASH_MANUAL", "deniedCode": null, "deniedMessage": null },
  "refunds": []
}
```

`eligibility.deniedCode` es `REFUND_PAYMENT_NOT_PAID`, `REFUND_ADMIN_ONLY`, `REFUND_CASHIER_DAY_LIMIT` o `REFUND_ROLE_NOT_ALLOWED` (SUPERVISOR). `refunds[]` usa el mismo objeto `refund` del `POST`, ordenado por `createdAt` ascendente. Nunca se expone `providerRaw`, `failureReason` ni la huella de idempotencia.

### `GET /api/v1/reports/branches/:branchId/refunds` (`format=csv`)

Mismas reglas de rango que los demás reportes (`from` y `to` obligatorios para ADMIN y SUPERVISOR, máximo 366 días y 92 en CSV; CASHIER forzado a hoy y a los reembolsos que él registró; WAITER, KITCHEN y BAR 403). La fecha es `refunds.completed_at` en hora del restaurante.

Filtros: `method` (medio del pago original), `cashierId` (quien cobró), `requestedById` (quien registró), `reasonCode`, `refundStatus` y `refundMethod` (listas separadas por coma; valor inválido da 400), `source`, `minAmount`, `maxAmount`, `hasTip`, `minTip`, `timeFrom`, `timeTo`, `weekdays`, `q` (comanda, mesa, cliente, cajero, mesero, quien registró y texto del motivo), `waiterId`, `tableId`, `zoneId`, `orderBy` (`completedAt` por defecto o `amount`), `direction`, `cursor`, `limit`.

```json
{
  "from": "2026-11-01", "to": "2026-11-20", "timeZone": "America/Santiago",
  "cashierId": null, "orderBy": "completedAt", "direction": "desc",
  "rows": [{
    "refundId": "uuid", "completedAt": "2026-11-20T15:04:05.000Z", "billId": "uuid",
    "orderNumber": "42", "table": "Mesa 1", "paymentId": "uuid",
    "paymentMethod": "CASH", "provider": "MANUAL",
    "amount": "3500", "consumption": "3000", "tip": "500", "net": "2521", "vat": "479",
    "refundMethod": "CASH_MANUAL", "status": "SUCCEEDED",
    "reasonCode": "CUSTOMER_COMPLAINT", "reasonText": "Plato frio",
    "requestedById": "uuid", "requestedBy": "Caro Cajera", "requestedByRole": "CASHIER",
    "approvedBy": null, "cashier": "Caro Cajera",
    "creditNoteStatus": "PENDING", "creditNoteFolio": null,
    "billHasActiveOrders": false
  }],
  "totals": {
    "count": 1, "amount": "3500", "consumption": "3000", "tip": "500", "net": "2521", "vat": "479",
    "byMethod": [{ "method": "CASH", "count": 1, "amount": "3500" }],
    "byReason": [{ "reasonCode": "CUSTOMER_COMPLAINT", "count": 1, "amount": "3500" }],
    "byRequester": [{ "staffUserId": "uuid", "name": "Caro Cajera", "count": 1, "amount": "3500" }]
  },
  "nextCursor": null, "limit": 50
}
```

`paymentMethod` incluye `SIN_CLASIFICAR`. Los totales cubren todo el filtro, no solo la página. CSV `reembolsos_{branchId}_{from}_{to}.csv` (UTF-8 con BOM, `;`, `\r\n`, fechas `dd-MM-yyyy HH:mm`, fórmulas neutralizadas) con cabeceras `Fecha;Comanda;Mesa;Medio de pago;Proveedor;Monto;Consumo;Propina;Neto;IVA;Motivo;Detalle;Registrado por;Rol;Aprobado por;Cajero;Metodo de reembolso;Estado;Nota de credito;Folio nota de credito` y fila final `TOTAL`.

### `PATCH /api/v1/branches/:branchId` y `POST /api/v1/branches` (ajustes)

`settings.cashierRefundLimit` (entero entre 0 y 9999999999, o `null`, tope diario por cajero; `null` = sin tope) y `settings.refundTipDefault` (boolean). Las respuestas devuelven `cashierRefundLimit: string | null` y `refundTipDefault: boolean`. Solo el ADMIN de la sucursal puede cambiarlos y cada cambio queda en `audit_logs` (`BRANCH_REFUND_SETTINGS_CHANGED`).

### `POST /api/v1/orders/:orderId/cancel`

Una orden prepagada en producción, o cuyos pagos ya cubren la cuenta, responde `409` con `{ "message", "code": "REFUND_REQUIRED", "billId" }`. El mensaje indica reembolsar desde el detalle de la cuenta y no promete que la orden se pueda anular después.

## Cómo restan los reembolsos los reportes

- **Neto** = consumo cobrado menos consumo reembolsado. La propina bruta no cambia; la propina reembolsada va en campos aparte (`tipRefunded`, `refundedTip`) y nunca entra a la venta neta ni a la base del 1%.
- **Fecha**: el reembolso resta en la fecha del reembolso (`completed_at`), no en la de la venta. Un reembolso de una venta de ayer baja el neto de hoy. Solo cuentan reembolsos `SUCCEEDED`.
- **Un solo fragmento SQL**: `refundJoinSql` en `reports/infrastructure/report-sql.ts` (un `LEFT JOIN LATERAL` por pago). Todo reporte nuevo que sume `payments` debe usarlo.

### `sales-by-order` (cierre por comanda)

Las filas siguen siendo las comandas cerradas en el rango. Campos nuevos o con valor real:

- Fila: `refunded` (consumo reembolsado en el rango sobre los pagos de la fila), `tipRefunded`, `net = total - refunded`, `refundStatus` (`NONE`, `PARTIAL`, `FULL`, del rango). `total`, `payable`, `tip` siguen brutos. `methods[]` muestra el monto NETO por medio (suma = `net`).
- `totals`: `refunded` (todos los reembolsos del rango, incluidos los de otros períodos), `tipRefunded`, `net`, `methods[]` netos (puede haber un medio negativo) y el bloque `otherPeriod { included, refunded, tipRefunded, methods[] }` con los reembolsos del rango sobre comandas cerradas fuera del rango. `otherPeriod.included` es `false` (montos en 0) cuando hay un filtro propio del cierre: `timeFrom`, `timeTo`, `weekdays`, `status`, `minTotal`, `maxTotal`, `hasTip`, `minTip`, `q`, `productId`, `productName` o `categoryPath`.
- Invariantes: `suma(filas.methods) = suma(filas.net)`; `suma(filas.refunded) + otherPeriod.refunded = totals.refunded`; `totals.net = totals.total - totals.refunded = suma(totals.methods)`. Sin reembolsos el resultado es el de M1 con los campos nuevos en 0.
- CSV: columnas `Propina reembolsada` y `Neto` después de `Reembolsado` (que ya tiene valor), medios netos y, si `otherPeriod.included` y no es 0, una fila `REEMBOLSOS DE OTROS PERIODOS` (reembolsado, propina reembolsada, neto y medios en negativo) antes de `TOTAL`.

### `payments` (detalle de pagos)

- Fila: `refunded` (consumo reembolsado en el rango), `refundedTip`, `refundStatus` (`NONE`, `PARTIAL`, `FULL`, de por vida del pago). Los intentos traen `0`, `0`, `NONE`. `amount`, `tip` y `total` siguen brutos.
- `totals.byMethod[]`: se agregan `refunded`, `refundedTip` y `net = amount - refunded`.
- `totals.otherPeriod { included, refunded, tipRefunded, byMethod: [{ method, refunded, tipRefunded }] }`: reembolsos del rango sobre pagos que no tienen fila. `included = false` con `kind = attempt`, `paymentStatus`, `q`, `timeFrom`, `timeTo`, `weekdays`, `hasTip`, `minTip`, `minAmount` o `maxAmount`.
- Invariante con el resumen del dashboard (sin filtros de fila): `suma(byMethod.amount) - suma(byMethod.refunded) - otherPeriod.refunded` es la venta neta de consumo de las cuentas cerradas en el rango (una cuenta con pagos divididos cae entera en el día de su último pago, igual que el dashboard; el doc de diseño decía "+" y era un error de signo).
- CSV: la columna `Reembolsado` tiene valor y se agrega `Propina reembolsada` al final.

### `sales-by-hierarchy`

Nodos y `totals` no cambian. La respuesta gana `refunds: { consumption, tip }` con todos los reembolsos del rango que cuentan en `sales-by-order` (filas más `otherPeriod`, mismo `periodRefundsSql`), sin prorrateo por producto: así `totals.amount - refunds.consumption` es el neto de `sales-by-order` cuando no hay filtros de pago (la jerarquía suma líneas, no pagos, y no aplica `method`, `cashierId` ni `source` a los montos). El CSV agrega, después de `TOTAL`, la fila `REEMBOLSOS (no asignados a productos)` con el monto en la columna `Monto`.

### `orders/:billId/detail`

Estado de la comanda (de por vida, no depende de un rango):

- `payments[]`: `refunded` (consumo devuelto), `refundedTip`, `refundable { total, consumption, tip }` (en 0 si el pago no está `PAID`).
- `refunds[]`: `id`, `paymentId`, `amount`, `tip`, `net`, `vat`, `method`, `status`, `reasonCode`, `reasonText`, `requestedBy`, `requestedById`, `approvedBy`, `completedAt`, `creditNoteStatus`. Un CASHIER solo recibe los que él registró.
- `totals`: `refunded` (consumo), `refundedTip`, `refundedTotal` (= `bills.refunded_amount`), `net = paid - refunded`. `paid`, `collected`, `difference` y `reconciled` siguen brutos.
- `flags.hasRefundedPayments` es `true` si `refundedTotal > 0`.

### Reportes de M3 (`sales-by-method`, `sales-by-staff`, `sales-by-time`, `tips`, `summary-kpis`)

Usan la misma definición (doc 33): `periodRefundsSql` entrega los reembolsos `SUCCEEDED` del rango por fecha de reembolso con el medio y cajero del pago y el mesero de la cuenta; `refunded` y `net` de todos son iguales a los de `sales-by-order` para el mismo filtro (incluidos los reembolsos de cuentas cerradas fuera del rango, salvo con filtros propios del cierre). `sales-by-staff` y `sales-by-time` ganan `refunded` y `net` (y `averageTicket` pasa a neto); `tips.returned` es la propina devuelta.

### `filter-options`

Sin cambios.

### Resumen del dashboard (`GET /api/v1/analytics/branches/:branchId/summary`)

`todayRevenue` es neto (ventas de hoy menos reembolsos de hoy); `todayRefunded`; `dailySeries[].amount` es neto por día y cada día trae `refunded`. Desde la corrección de la revisión, `todayRevenue`, `todayPaymentsCount` (cuentas cerradas hoy, ya no pagos), `dailySeries[].amount` y `dailySeries[].count` salen del mismo SQL de cuentas elegibles de los reportes (`findPeriodBuckets` con bucket `day`): una cuenta con pagos divididos cae entera en el día de su último pago, igual que `sales-by-order`, `summary-kpis` y `sales-by-time`, así que la tarjeta de hoy y Reportes > Hoy cuadran. `averageTicket = max(0, todayRevenue) / todayPaymentsCount` (nunca negativo; 0 sin cuentas).

## Configuración y límites conocidos

- `TRUST_PROXY_HOPS` (entero >= 0, por defecto 0): número exacto de proxys de confianza delante de la API. Con 0 la `ip` de auditoría es la del socket. Con N > 0 Express usa `trust proxy = N` y `request.ip` sale de `X-Forwarded-For` contando desde la derecha; nunca se lee la primera entrada que envía el cliente.
- El reporte de reembolsos usa `completed_at` para el rango y el orden: los reembolsos `PENDING`, `FAILED` y `REQUIRES_MANUAL_REVIEW` (hoy inexistentes: todo reembolso de M4 nace `SUCCEEDED`) no aparecen aunque el filtro `refundStatus` los acepte. Cuando M6 cree reembolsos de pasarela pendientes, el reporte deberá usar `COALESCE(completed_at, created_at)`.
- La aprobación sigue sin escalar bloqueos acumulados ni exigir 6 dígitos: el PIN de aprobación admite 4 a 6 dígitos y el contador se reinicia tras cada ventana de bloqueo de 15 minutos.

## Base de datos

Migración `prisma/migrations/20261120120000_refunds_cash_audit/migration.sql` (idempotente, aditiva, con RLS en las tres tablas nuevas). NO se aplica sola: la aprueba el dueño y se corre con `prisma migrate deploy` contra `DIRECT_URL`, tras un snapshot o rama de Supabase.

Orden de despliegue (crítico): verificar en QA `SELECT count(*) FROM payments WHERE amount < 0 OR tip_amount < 0 OR tip_amount > amount;` (debe dar 0), aplicar la migración, confirmar las columnas nuevas y recién entonces desplegar el código (el cliente Prisma selecciona todas las columnas escalares: sin la migración fallan pagos, cuentas, QR y ajustes de sucursal, no solo los reportes). Con la migración aplicada el código anterior sigue funcionando.

- `payments.refunded_amount`, `payments.refunded_tip_amount`, `bills.refunded_amount`, `staff_users.approval_pin_failed_attempts`, `staff_users.approval_pin_locked_until`, `branch_settings.cashier_refund_limit`, `branch_settings.refund_tip_default`.
- Tablas `refunds`, `cash_movements`, `audit_logs`, enums `RefundStatus`, `RefundMethod`, `RefundReason`, `CashMovementType`.
- `CHECK`: `refunded_amount` entre 0 y `amount`, propina devuelta entre 0 y la propina del pago, consumo devuelto entre 0 y el consumo, `refunds.amount > 0`, `reason_text` con al menos 3 caracteres, `net + vat = amount - tip`, `SUCCEEDED` exige `completed_at`, signo de `cash_movements.amount` por tipo.
- Triggers: `audit_logs` y `cash_movements` son de solo inserción (se bloquean `UPDATE`, `DELETE` y `TRUNCATE`); `refunds` no se borra y sus columnas financieras no cambian. Las tres funciones de trigger fijan `SET search_path = ''`.
- `CashMovement.amount` lleva signo. Fórmula de caja esperada para M7 (no implementada): pagos `CASH` `PAID` brutos del turno más `SUM(cash_movements.amount)` del turno; no se arma desde el neto de los reportes sumando además `REFUND_OUT`.

## Verificación

Specs de dominio (`refund-amounts`, `refund-mode`), servicios (`refund-payment`, `list-payment-refunds`), controlador, DTO, auditoría, `verifyStaffPin`, `ensureAccess(..., { fresh: true })`, ajustes de sucursal, `cancel-order`, y los reportes (forma del SQL, servicios, controlador, DTO, dashboard). Además se ejecutaron en PGlite (Postgres en WASM, fuera del repositorio) la migración completa dos veces, los `CHECK`, los triggers, la sentencia atómica del PIN, el `UPDATE` condicional con el servicio real y todas las consultas de reportes con reembolsos sembrados sobre 4 rangos y 14 combinaciones de filtros, comprobando las invariantes de arriba contra sumas independientes. PGlite tiene una sola conexión: la carrera real entre dos solicitudes se cubre por la semántica del `UPDATE` (el segundo ve la fila ya actualizada y recibe cero filas) y por una prueba unitaria que simula esa segunda solicitud.


## Reembolso por pasarela (M6)

Los pagos `TRANSBANK` y `MERCADO_PAGO` con lo necesario para reembolsar (MP: `providerReference`; Transbank: `providerReference` más `gatewayMeta.buy_order` y `gatewayMeta.childCommerceCode`) se reembolsan por defecto con `method = GATEWAY`. Solo ADMIN (el cajero recibe 403 `REFUND_ADMIN_ONLY`). El body admite `registerAsManual: true` (solo ADMIN) para mantener el comportamiento `MANUAL_EXTERNAL` de M4. Los pagos históricos sin datos de pasarela siguen siendo manuales.

Flujo: TX1 reserva el saldo igual que antes y crea el `Refund` en `PENDING` (sin movimiento de caja; auditoría `REFUND_REQUESTED`); después, fuera de toda transacción, se llama a la pasarela con `refund.id` como clave de idempotencia; TX2 deja `SUCCEEDED` (auditoría `REFUND_SUCCEEDED`), o `FAILED` liberando la reserva en la misma transacción (`REFUND_FAILED`), o lo deja `PENDING` si el resultado es ambiguo. La respuesta de `POST /refunds` expone `refund.status` (`PENDING`, `SUCCEEDED`, `FAILED`, `REQUIRES_MANUAL_REVIEW`) y `refund.failureReason`.

Endpoints nuevos (solo ADMIN, auditados): `POST /v1/refunds/:id/retry` y `POST /v1/refunds/:id/mark-manual`. Detalle completo, contratos, conciliación y webhook en `docs/35-reembolsos-por-pasarela.md`.
