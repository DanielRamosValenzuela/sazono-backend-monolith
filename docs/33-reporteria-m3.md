# 33. Reportería M3: ventas por medio, mesero, hora, propinas, cuentas abiertas y KPIs

Tercer hito de la especificación de reportería (`docs/11-spec-reporteria-y-reembolsos.md` del repositorio raíz, secciones 4 punto 4 y 6 hito M3). Agrega seis reportes de solo lectura sobre los mismos datos de M1. No hay migración: no se crea ni se modifica ninguna tabla.

Todos viven bajo `GET /api/v1/reports/branches/:branchId/...`, usan los mismos guards (`JwtAuthGuard`, `ProfileTypeGuard` STAFF) y el mismo servicio de alcance (`ReportScopeService`) que `sales-by-order`.

## Reglas comunes

- **Roles**: ADMIN y SUPERVISOR ven todo. CASHIER ve solo sus propios cobros de hoy (el servidor fuerza `cashierId` = su usuario y `from = to = hoy`, e ignora los de la query). WAITER, KITCHEN y BAR reciben 403. Las excepciones por reporte están en cada sección.
- **Filtros** (`sales-by-method`, `sales-by-staff`, `sales-by-time`, `tips`, `summary-kpis`): son exactamente los de `sales-by-order` salvo orden y paginación: `from`, `to` (obligatorios para ADMIN y SUPERVISOR, máximo 366 días, 92 con CSV), `cashierId`, `method`, `waiterId`, `tableId`, `zoneId`, `source`, `status`, `minTotal`, `maxTotal`, `hasTip`, `minTip`, `timeFrom`, `timeTo`, `weekdays`, `q`, `productId`, `productName`, `categoryPath`, `format`. Los parámetros `orderBy`, `direction`, `cursor` y `limit` se rechazan con 400.
- **Fechas**: rangos semiabiertos `[from 00:00, to+1 00:00)` en la zona horaria del restaurante. La cuenta se atribuye al instante `MAX(paid_at)` de sus pagos PAID, igual que `sales-by-order`.
- **Dinero**: enteros CLP en string. La propina nunca entra en la venta.
- **CSV**: `format=csv`, separador `;`, BOM UTF-8, mismo escape que M1. Los números no enteros (participación, porcentajes, rotación) usan coma decimal (`33,87`) para abrirse en Excel es-CL; los montos son enteros. El nombre del archivo lleva el reporte, la sucursal y el rango.
- **Reembolsos (M4, integrados)**: `refunded`, `returned` y los netos son reales y usan la misma definición que `sales-by-order` (doc 32): reembolsos `SUCCEEDED` atribuidos a la fecha del reembolso (`completed_at`), parte de consumo `amount - tip_amount`, sobre pagos `PAID` que cumplen los filtros de pago y de mesa. El fragmento común es `periodRefundsSql` en `infrastructure/report-sql.ts` (la propina devuelta es `tip_amount`). Igual que `sales-by-order`, un reembolso del rango sobre una cuenta cerrada fuera del rango cuenta (aparece en el bucket, medio, mesero o cajero que corresponde a su fecha y a su pago); si hay un filtro propio del cierre (`timeFrom`, `timeTo`, `weekdays`, `status`, `minTotal`, `maxTotal`, `hasTip`, `minTip`, `q`, `productId`, `productName`, `categoryPath`) solo cuentan los reembolsos de las cuentas elegibles. Por eso una fila puede tener `bills = 0` y `net` negativo (solo reembolsos). Atribución del reembolso: al medio y al cajero del pago original, al mesero de la cuenta (misma cascada), y a la hora, día o mes de la fecha del reembolso en la zona del restaurante.
- **Cuadratura**: la base de todos los reportes es el mismo SQL de cuentas elegibles de `sales-by-order` (`eligibleBillsSql`). Para un mismo filtro: `sales-by-method.totals.amount` = suma de `sales-by-staff` (mesero o cajero) = suma de `sales-by-time` (cualquier bucket) = suma del mapa de calor = `tips.totals.sales` = `summary-kpis.current.grossSales` = `sales-by-order.totals.total`; y `tips.totals.tip` = `sales-by-order.totals.tip`. Con reembolsos: `refunded` y `net` de `sales-by-method`, `sales-by-staff` (ambos roles), `sales-by-time` (cualquier bucket), `summary-kpis` y `sales-by-hierarchy.refunds.consumption` (más `totals.amount - refunds.consumption` cuando no hay filtros de pago) son iguales a `sales-by-order.totals.refunded` y `totals.net` (que incluyen `otherPeriod`); `tips.totals.returned` = `sales-by-order.totals.tipRefunded`; y sin filtros del cierre `sales-by-order.totals.refunded` = `refunds.totals.consumption` del reporte de reembolsos y `suma(payments.rows.refunded) + payments.otherPeriod.refunded` también. Se verificó en PGlite con 28 combinaciones de filtros y datos con reembolsos parciales, múltiples, de otro día, de propina, pendientes/fallidos (no cuentan) y sobre una cuenta abandonada.

## 1. `sales-by-method`

Una fila por medio de pago presente, ordenadas por neto descendente.

```json
{
  "from": "2026-07-10", "to": "2026-07-16", "timeZone": "America/Santiago", "cashierId": null,
  "rows": [
    { "method": "CASH", "label": "Efectivo", "count": 3, "bills": 3, "amount": "21000", "tip": "2000", "refunded": "0", "net": "21000", "share": 53.5 }
  ],
  "totals": { "count": 7, "amount": "39250", "tip": "2750", "refunded": "0", "net": "39250" }
}
```

- `count`: pagos; `bills`: cuentas distintas con ese medio; `amount`: consumo sin propina; `net = amount - refunded`; `share`: porcentaje del neto total con 2 decimales (0 si el total es 0).
- `method` es uno de `CASH, CREDIT_CARD, DEBIT_CARD, TRANSFER, MERCADO_PAGO, VOUCHER, MACH, OTHER, SIN_CLASIFICAR`.
- CSV: `Medio de pago;N° pagos;Monto;Propina;Reembolsado;Neto;Participacion %` más fila `TOTAL`.

## 2. `sales-by-staff?role=waiter|cashier`

`role` por defecto `waiter`.

```json
{
  "role": "waiter", "from": "...", "to": "...", "timeZone": "...", "cashierId": null,
  "rows": [
    { "staffId": "uuid|null", "name": "Ana Mesera", "bills": 2, "guests": 3, "amount": "18000", "refunded": "3000", "net": "15000", "averageTicket": "7500", "tip": "1000", "tipPerBill": "500" }
  ],
  "totals": { "bills": 6, "guests": 14, "amount": "39250", "refunded": "3000", "net": "36250", "tip": "2750", "averageTicket": "6042", "tipPerBill": "458" }
}
```

- `role=waiter`: una cuenta pertenece a un solo mesero, resuelto con `COALESCE(TableSession.assignedStaffUserId, TableSession.openedByStaffUserId, primera Order.createdByStaffUserId de la cuenta por fecha)`. Sin ninguno: `staffId: null`, `name: "Sin asignar"`. Regla distinta de `sales-by-order` (que muestra solo el asignado) y del filtro `waiterId` (que filtra solo por el asignado): con `waiterId` el reporte excluye cuentas cuyo mesero se resolvió por fallback.
- `role=cashier`: se agrupa por cada pago (`Payment.staffUserId`). Pagos sin cajero: `staffId: null` con `name: "QR/Online"` si el origen es `WEB_QR`, o `"Sin asignar"`. Una cuenta cobrada por dos cajeros cuenta como cuenta (y comensales) en cada uno: `amount` y `tip` siempre cuadran, pero `totals.bills` y `totals.guests` pueden superar el número real de cuentas.
- `refunded` y `net = amount - refunded` (reembolsos del mesero de la cuenta o del cajero del pago; una fila de solo reembolsos tiene `bills = 0`). `averageTicket = net / bills` y `tipPerBill = tip / bills`, redondeo half-up a CLP.
- CASHIER: solo `role=cashier` y devuelve únicamente su fila de hoy. `role=waiter` responde 403.
- CSV: `Nombre;Cuentas;Comensales;Monto;Reembolsado;Neto;Ticket promedio;Propina;Propina por cuenta` más `TOTAL`.

## 3. `sales-by-time?bucket=hour|weekday|day|month`

`bucket` por defecto `hour`. Buckets en la zona horaria del restaurante sobre `MAX(paid_at)` de la cuenta.

```json
{
  "bucket": "hour", "from": "...", "to": "...", "timeZone": "...", "cashierId": null,
  "rows": [{ "key": "12", "label": "12:00", "bills": 2, "guests": 5, "amount": "20000", "refunded": "1000", "net": "19000", "averageTicket": "9500", "tip": "2000" }],
  "totals": { "bills": 6, "guests": 14, "amount": "39250", "refunded": "1000", "net": "38250", "averageTicket": "6375", "tip": "2750" },
  "heatmap": { "weekdays": ["Lunes", "..."], "hours": [0, 1, "..."], "amount": [["0", "..."]], "bills": [[0, "..."]] }
}
```

- `hour`: 24 filas (`key` `00` a `23`). `weekday`: 7 filas (`key` `1` lunes a `7` domingo, ISODOW). `day`: una fila por día del rango (`key` `YYYY-MM-DD`, `label` `dd-MM-yyyy`). `month`: una fila por mes tocado por el rango (`key` `YYYY-MM`, `label` `MM-yyyy`). Los buckets sin ventas salen en cero.
- `heatmap` solo con `hour` y `weekday`; con `day` y `month` es `null`. Matriz 7 x 24: `amount[weekday - 1][hour]` y `bills[weekday - 1][hour]`, lunes primero. Un solo SQL agrupa por (ISODOW, hora) y de él salen filas y matriz.
- Una cuenta cobrada a las 23:30 locales del día 15 (03:30 UTC del 16) queda en el día 15, hora 23.
- `refunded` se atribuye al bucket de la fecha del reembolso (no al de la venta); `net = amount - refunded` y `averageTicket = net / bills`. El mapa de calor `heatmap.amount` es NETO (su suma es `totals.net`); `heatmap.bills` cuenta cuentas cerradas.
- CSV: `Periodo;Cuentas;Comensales;Monto;Reembolsado;Neto;Ticket promedio;Propina` más `TOTAL`.

## 4. `tips`

```json
{
  "from": "...", "to": "...", "timeZone": "...", "cashierId": null,
  "totals": { "bills": 6, "sales": "39250", "tip": "2750", "tipPercent": 7.01, "returned": "0", "tipOwed": "2750" },
  "byWaiter": [{
    "staffId": "uuid|null", "name": "Wil Mesero", "bills": 2, "sales": "16000", "tip": "1500", "tipPercent": 9.38,
    "returned": "0", "tipOwed": "1500", "cashTip": "1000", "cardTip": "500", "otherTip": "0",
    "cardTipPending": "0", "cardTipOverdue": "500",
    "oldestCardTipDate": "2026-07-15", "oldestCardTipDueDate": "2026-07-24", "oldestCardTipAgeDays": 126,
    "payoutStatus": "OVERDUE"
  }],
  "byDay": [{ "date": "2026-07-15", "bills": 4, "sales": "34000", "tip": "2500", "tipPercent": 7.35, "returned": "0" }],
  "payout": { "businessDays": 7, "cardMethods": ["CREDIT_CARD", "DEBIT_CARD", "MERCADO_PAGO", "MACH"], "asOf": "2026-11-18", "cardTipPending": "300", "cardTipOverdue": "750", "overdueWaiters": 2 }
}
```

- `tipPercent`: propina sobre venta (consumo) en porcentaje con 2 decimales. `returned` es la propina devuelta al cliente (reembolsos `SUCCEEDED` con propina, atribuidos a la fecha del reembolso, al mesero de la cuenta; `byDay` los pone en el día del reembolso, así que un día puede tener `returned` sin cuentas); `tipOwed = tip - returned`. `sales` sigue bruto.
- Mesero con la misma atribución con fallbacks que `sales-by-staff?role=waiter` (`"Sin asignar"` si no hay). `byWaiter` va por propina descendente; `byDay` ascendente por día de la cuenta.
- **Plazo de 7 días hábiles**: la propina cobrada con tarjeta o medio electrónico (`cardMethods`) debe pagarse al mesero en máximo 7 días hábiles. Se agrupa por día local de `Payment.paidAt`; el vencimiento de cada día es ese día más 7 días hábiles (lunes a viernes, sin feriados) y está vencida si `asOf` (hoy en la zona del restaurante) es posterior al vencimiento. `cashTip` es propina en efectivo, `otherTip` el resto (transferencia, vale, otro, sin clasificar), que no tienen plazo.
- `cardTipPending`, `cardTipOverdue` y las fechas de antigüedad se calculan sobre la propina de tarjeta menos la ya devuelta (`payments.refunded_tip_amount`, de por vida): `cardTip` queda bruto pero lo que se debe pagar al mesero baja si se devolvió la propina al cliente.
- `payoutStatus`: `NO_CARD_TIPS` (sin propina con tarjeta), `PENDING` (todo dentro del plazo) u `OVERDUE` (alguna vencida). `oldestCardTipDate`, `oldestCardTipDueDate` y `oldestCardTipAgeDays` describen la propina con tarjeta más antigua del rango.
- No hay tablas de pagos de propina: no se sabe si se pagó. `OVERDUE` significa "venció el plazo legal para pagarla", no "no fue pagada"; la UI debe decir plazo vencido. Cuando exista el registro de reparto, se descuenta de `cardTipPending` y `cardTipOverdue`.
- CSV: una fila por mesero con las columnas anteriores más `TOTAL`.

## 5. `open-tabs?kind=open|abandoned|cancelled`

Solo ADMIN y SUPERVISOR (CASHIER recibe 403: una cuenta abierta no tiene cobros propios). Acepta `waiterId` (mesero asignado), `tableId` y `zoneId`.

- `kind=open` (por defecto): sesiones `OPEN` con cuenta `OPEN` o `PARTIALLY_PAID` (o sin cuenta). No usa `from`/`to`; responden `from: null, to: null`. La edad es `ahora - openedAt`. Orden: más antiguas primero.
- `kind=abandoned`: sesiones `ABANDONED` con `closedAt` dentro del rango (requiere `from` y `to`). Edad = `closedAt - openedAt`. Orden: cierre descendente.
- `kind=cancelled`: sesiones con al menos una orden `CANCELLED` actualizada en el rango (requiere `from` y `to`). Edad = última anulación menos `openedAt`. `cancelledOrders` y `cancelledAmount` (`precio * cantidad` de sus líneas) vienen informados. Orden: última anulación descendente. `BillStatus.VOID` no se usa en el sistema, por eso "anulada" se define por órdenes. Las anulaciones a nivel de línea (un ticket de estación cancelado deja sus `order_items` en `CANCELLED` sin cancelar la orden) no aparecen aquí; se ven en `sales-by-hierarchy` (`cancelledQuantity`).

```json
{
  "kind": "open", "from": null, "to": null, "timeZone": "America/Santiago", "alertAfterMinutes": 180,
  "rows": [{
    "sessionId": "uuid", "billId": "uuid|null", "orderNumber": "42", "table": "Mesa 1", "zone": "Terraza", "waiter": "Ana|null",
    "customerLabel": null, "isCounter": false, "guests": 2, "sessionStatus": "OPEN", "billStatus": "PARTIALLY_PAID",
    "openedAt": "ISO", "endedAt": null, "ageMinutes": 200, "total": "20000", "paid": "12000", "pending": "8000",
    "alert": true, "closeReason": null, "cancelledOrders": null, "cancelledAmount": null
  }],
  "truncated": false,
  "totals": { "count": 4, "pending": "28000", "alerts": 2 }
}
```

- `alert` es true solo en `kind=open` con `ageMinutes > 180`. Máximo 500 filas; si hay más, `truncated: true`.
- `orderNumber`: `ticketNumber` de la sesión o los últimos 6 caracteres del id de la cuenta (o de la sesión).
- CSV: `Comanda;Mesa;Zona;Mesero;Cliente;Comensales;Estado;Apertura;Cierre;Minutos;Total;Pagado;Pendiente;Alerta;Motivo;Ordenes anuladas;Monto anulado`.

## 6. `summary-kpis?compare=previous`

Reemplaza al resumen de analytics para el tablero (corrige la zona horaria: usa rangos del restaurante, no `setHours` del servidor).

```json
{
  "from": "2026-07-14", "to": "2026-07-15", "timeZone": "...", "cashierId": null,
  "current": { "grossSales": "37000", "refunded": "0", "netSales": "37000", "tips": "2500", "bills": 5, "averageTicket": "7400", "guests": 12, "tablesTurnover": "1.00" },
  "previousRange": { "from": "2026-07-12", "to": "2026-07-13" },
  "previous": { "...": "mismo bloque" },
  "delta": { "netSales": { "absolute": "34750", "percent": 1544.44 }, "tablesTurnover": { "absolute": "0.75", "percent": 300 } }
}
```

- `netSales = grossSales - refunded`; `grossSales` es igual a `sales-by-order.totals.total` para el mismo filtro. `averageTicket = netSales / bills`.
- `tablesTurnover`: cuentas de mesas físicas (no virtuales) dividido por (mesas físicas de la sucursal x días del rango). `null` si no hay mesas físicas. Usa las mesas actuales de la sucursal.
- Sin `compare`, `previousRange`, `previous` y `delta` son `null`. Con `compare=previous` el rango anterior tiene la misma duración y termina el día anterior a `from`; los filtros se aplican igual a ambos rangos. `delta[clave]` tiene `absolute` en string (con signo; 2 decimales en `tablesTurnover`) y `percent` (`null` si el valor anterior es 0). `delta[clave]` es `null` si falta un lado (`tablesTurnover`).
- CASHIER: ve solo sus cobros de hoy y `compare` se ignora (`previous: null`), para no ampliar su ventana de hoy.
- CSV: `Indicador;Actual;Anterior;Variacion;Variacion %` con una fila por indicador.

## Verificación

- Especificaciones Jest: `insights-builders.spec.ts`, `insights.services.spec.ts`, `reports-insights.prisma.repository.spec.ts`, `reports-insights.controller.spec.ts` (con las pruebas de los DTO).
- Todo el SQL nuevo se ejecutó contra PGlite con datos sembrados (cuentas con pago mixto, QR, sin método, mesero por fallback, cuentas abiertas, abandonadas y con órdenes anuladas, propinas con tarjeta vencidas y vigentes) y un copiado del esquema de pruebas: 499 verificaciones, entre ellas la cuadratura entre reportes bajo 14 filtros y el alcance por rol. El harness queda fuera del repositorio.
