# 30. Reportería: filtros libres, detalle de comanda y opciones de filtro

Extiende M1 (`27-reporteria-m1.md`) y M2 (`28-reporteria-m2-jerarquia.md`). Todo lo nuevo es opcional y compatible hacia atrás: sin parámetros nuevos las respuestas son las mismas de antes (más los campos `orderBy` y `direction` en las listas). No hay migración nueva.

## Reglas generales de los filtros

- Todos los filtros se validan en el DTO (class-validator) y otra vez en `report-filters.ts` (`parseReportFilters`), y llegan a Postgres solo como parámetros (`Prisma.sql`). Un valor inválido responde 400. Parámetros desconocidos también (`forbidNonWhitelisted`).
- Los mismos filtros se aplican igual a filas, totales, cursores de paginación y CSV. La consulta de totales y la de filas comparten el mismo SQL de "cuentas elegibles" (`eligibleBillsSql`) o de "pagos filtrados" (`paymentsFilteredSql`), por eso `suma(medios) = suma(filas) = totales` se mantiene con cualquier combinación.
- Roles: ADMIN y SUPERVISOR usan todo. CASHIER sigue forzado a sus propios cobros de hoy (`cashierId` y rango se ignoran de la query); los filtros nuevos solo pueden acotar dentro de ese alcance, nunca ampliarlo. WAITER, KITCHEN y BAR reciben 403. La jerarquía sigue siendo solo ADMIN y SUPERVISOR.
- Listas separadas por comas: se eliminan duplicados y espacios. Cualquier valor fuera del catálogo da 400 (no se ignora en silencio).
- Hora y día se interpretan en la zona horaria del restaurante.

## Filtros comunes (sales-by-order, payments, sales-by-hierarchy)

| Parámetro | Tipo | Valores | Efecto |
| --- | --- | --- | --- |
| `cashierId` | uuid | | Pagos cobrados por ese usuario (ya existía). |
| `method` | lista | CASH, CREDIT_CARD, DEBIT_CARD, TRANSFER, MERCADO_PAGO, VOUCHER, MACH, OTHER, SIN_CLASIFICAR | Solo pagos con esos medios (ya existía). |
| `waiterId` | uuid | | Mesero asignado a la sesión de la mesa de la comanda. |
| `tableId` | uuid | | Mesa de la comanda. |
| `zoneId` | uuid | | Zona de la mesa de la comanda. |
| `source` | lista | WEB_QR, CASHIER, WAITER | Origen del pago (`payments.source`). Los pagos históricos sin origen no coinciden con ningún valor. |
| `timeFrom` | `HH:mm` | 00:00 a 23:59 | Hora del día inicial, inclusiva al minuto. |
| `timeTo` | `HH:mm` | 00:00 a 23:59 | Hora del día final, inclusiva al minuto. Si `timeFrom > timeTo` el rango cruza la medianoche (22:00 a 02:00 = desde las 22:00 hasta las 02:00 del día siguiente, ambos inclusivos al minuto). Se puede dar solo uno de los dos. |
| `weekdays` | lista | 1 a 7 (ISO, 1 lunes, 7 domingo) | Día de la semana, en la zona horaria del restaurante. |

La hora y el día se miden sobre la fecha de cierre de la comanda (`sales-by-order`, jerarquía) o sobre la fecha del evento (`payments`, que es `paidAt` o, si no hay, `createdAt`).

## Filtros de `sales-by-order` y `payments` (listas)

| Parámetro | Tipo | Efecto |
| --- | --- | --- |
| `q` | texto, máx. 100 caracteres tras recortar | Búsqueda libre sin distinguir mayúsculas: número de comanda (ticket o últimos 6 del id), nombre de mesa, nombre del cliente de la sesión (`customer_label`), nombre del cajero y del mesero. En `payments` también la referencia del proveedor. Los caracteres `%` y `_` se tratan como texto literal: el patrón se escapa con `!` y la consulta usa `ILIKE ? ESCAPE '!'`. |
| `hasTip` | `true` o `false` | Solo con propina o solo sin propina. |
| `minTip` | entero >= 0 | Propina mínima en pesos. Con `hasTip=false` y `minTip > 0` da 400. |
| `orderBy` | enum | `sales-by-order`: `closedAt` (defecto), `total`, `tip`, `orderNumber`. `payments`: `eventAt` (defecto), `amount`, `tip`. |
| `direction` | `asc` o `desc` | Defecto `desc`. |

### Solo `sales-by-order`

| Parámetro | Tipo | Efecto |
| --- | --- | --- |
| `status` | lista | `PAID_FULL` (UI "Pagado") o `MIXED` (UI "Mixto"). Mixto = más de un medio de pago entre los pagos que cumplen el resto de los filtros, igual que la etiqueta de la fila. |
| `minTotal`, `maxTotal` | entero >= 0 (máx. 1.000.000.000) | Total de la comanda (consumo sin propina) entre esos valores, inclusivo. `minTotal > maxTotal` da 400. |
| `productId` | uuid | Comandas con una línea vendida de ese ítem de carta (`order_items.menu_item_id`). |
| `productName` | texto, máx. 200 | Comandas con una línea vendida cuyo nombre (snapshot) es igual, sin distinguir mayúsculas. Útil porque cada versión de carta tiene ids distintos. |
| `categoryPath` | texto | Camino de categoría separado por `>`, de 1 a 4 niveles, por ejemplo `Cafe > Bebidas Calientes`. Coincide por prefijo con `order_items.category_path_snapshot`; `(Sin categoria)` coincide con las líneas sin snapshot. |

`productId`, `productName` y `categoryPath` se evalúan sobre la misma línea (deben cumplirse a la vez en un mismo ítem). "Línea vendida" usa la regla de la jerarquía: ítem no cancelado de un pedido en CONFIRMED, ROUTED, IN_PREPARATION, PARTIALLY_READY, READY o DELIVERED.

### Solo `payments`

| Parámetro | Tipo | Efecto |
| --- | --- | --- |
| `minAmount`, `maxAmount` | entero >= 0 | Monto de la fila (consumo sin propina) entre esos valores. |
| `kind`, `provider`, `paymentStatus` | | Sin cambios. |

`cashierId`, `method` y `source` excluyen los intentos (no tienen cajero, medio ni origen), igual que antes con cajero y medio. Los demás filtros sí aplican a pagos e intentos.

### Solo `sales-by-hierarchy`

Acepta `cashierId`, `waiterId`, `method`, `source`, `zoneId`, `tableId`, `timeFrom`, `timeTo` y `weekdays`, además de `from`, `to`, `groupBy`, `parentId`, `includeModifiers`, `format`.

## Semántica de los filtros en `sales-by-order`

La cuenta es elegible si tiene al menos un pago PAID que cumple los filtros a nivel de pago (`cashierId`, `method`, `source`) y su fecha de cierre (el `MAX(paid_at)` de todos sus pagos PAID, como en M1) cae en el rango. Sobre las cuentas elegibles:

- `total`, `tip` y el estado Pagado o Mixto de la fila se calculan con los pagos que cumplen los filtros a nivel de pago. Los filtros `status`, `minTotal`, `maxTotal`, `hasTip` y `minTip` se evalúan contra esos mismos valores: lo que el usuario ve en la fila es lo que se filtra.
- `waiterId`, `tableId`, `zoneId`, hora, día, `q`, `productId`, `productName` y `categoryPath` filtran cuentas completas; no cambian los montos de la fila.
- Los totales (`totals`) suman exactamente los pagos que cumplen los filtros de las cuentas elegibles. `totals.bills` sale en la misma consulta que las columnas por medio.

## Orden y paginación

Cursor opaco (base64url de `valor|billId`). El valor depende del orden: fecha ISO (`closedAt`, `eventAt`), número con 2 decimales (`total`, `tip`, `amount`) o clave de texto (`orderNumber`). El desempate siempre es el id de la cuenta (o del pago) en la misma dirección, por lo que el recorrido es estable aunque haya valores repetidos. Con `desc` la condición es `(col < v OR (col = v AND id < cursorId))` y con `asc` es `>`. Un cursor que no corresponde al orden pedido responde 400. Los cursores de M1 (`ISO|id`) siguen siendo válidos con `closedAt`.

`orderNumber` ordena por el número de ticket de mostrador con ceros a la izquierda (así 7 va antes que 42) y, si no hay ticket, por los últimos 6 caracteres del id; ambos con collation `C`, tickets antes que ids.

## GET /reports/branches/:branchId/orders/:billId/detail

Misma autorización que `sales-by-order`: ADMIN y SUPERVISOR ven cualquier comanda de la sucursal; CASHIER solo si la cuenta tiene un pago PAID cobrado por él hoy (hora del restaurante). Si la cuenta no existe, es de otra sucursal o el cajero no tiene acceso responde 404 (no se distingue). WAITER, KITCHEN, BAR dan 403. `billId` debe ser UUID.

Hace 3 consultas en paralelo (cabecera, líneas con modificadores, pagos), más la verificación de acceso.

Respuesta (dinero como string en pesos enteros, fechas ISO):

- `billId`, `orderNumber`, `billStatus` (OPEN, PARTIALLY_PAID, PAID, ABANDONED, VOID), `timeZone`.
- `table { id, name }`, `zone { id, name } | null`, `waiter { id, name } | null`, `openedBy`, `cashiers[]`, `guests`, `customerLabel`, `isCounter`.
- `openedAt`, `closedAt`, `paidAt` (último pago PAID), `sessionOpenedAt`, `sessionClosedAt`, `closeReason`.
- `orders[]`: `id`, `status`, `source`, `createdAt`, `notes`.
- `items[]`: `id`, `orderId`, `orderStatus`, `name`, `productId`, `categoryPath[]`, `categoryLabel`, `station`, `quantity`, `unitPrice` (incluye modificadores, como se cobra), `baseUnitPrice`, `modifiers[] { name, priceDelta }`, `modifiersTotal`, `lineTotal`, `notes`, `status`, `cancelled` (línea o pedido cancelado), `counted` (entra en la venta: no cancelada y de un pedido vendido).
- `payments[]`: `id`, `method`, `methodLabel`, `provider`, `providerReference`, `amount` (consumo), `tip`, `total`, `status`, `cashier`, `cashierId`, `caja`, `source`, `paidAt`, `createdAt`. Incluye todos los estados.
- `totals`: `itemsCount`, `itemsTotal` (líneas `counted`), `excludedItemsTotal` (líneas canceladas o de pedidos no vendidos), `billTotal`, `remaining`, `paid` (consumo de pagos PAID), `tip`, `collected`, `difference` (`itemsTotal - paid`), `paidPaymentsCount`, `refunded` (consumo reembolsado de por vida), `refundedTip`, `refundedTotal` (`bills.refunded_amount`), `net` (`paid - refunded`), `reconciled` (`difference == 0`). `paid`, `collected` y `difference` siguen brutos para que la conciliación no cambie. Además `payments[]` trae `refunded`, `refundedTip` y `refundable`, y la respuesta trae `refunds[]` (ver `32-reembolsos.md`).
- `flags`: `partiallyPaid`, `abandoned`, `voided`, `overpaid`, `hasCancelledItems`, `hasUnclassifiedPayments`, `hasRefundedPayments`, `hasOpenPayments` (PENDING o AUTHORIZED), `mixedMethods`.

## GET /reports/branches/:branchId/filter-options

Una sola consulta SQL que devuelve un JSON. Roles: ADMIN, SUPERVISOR y CASHIER (a CASHIER solo se le entrega su propio usuario en `staff`).

- `windowDays` (90) y `since`.
- `staff[]`: `id`, `name`, `roles[]` (roles activos en la sucursal), `active` (usuario ACTIVE con algún rol activo), `hasPayments`. Incluye al personal con algún rol en la sucursal (activo o no) y a quien haya cobrado pagos allí, para poder filtrar por personal que ya no trabaja.
- `zones[]`, `tables[]` (`id`, `name`, `code`, `zoneId`, `isVirtual`).
- `paymentMethods[]` (`method`, `label`) con los medios usados en pagos PAID de los últimos 90 días, en el orden canónico; `SIN_CLASIFICAR` aparece si hay pagos sin medio. Además `providers[]` y `sources[]` en uso.
- `categories[]` (`path`, `label`, `level`, `quantity`): cada categoría y cada prefijo de camino vendido en los últimos 90 días. `label` es el valor listo para `categoryPath`.
- `products[]` (`id`, `name`, `categoryPath`, `categoryLabel`, `quantity`): hasta 500 productos vendidos (más vendidos primero). `id` es el ítem de carta más reciente con ese nombre; para filtrar usa `productName` si el producto cambió de versión de carta.

## Totales consistentes entre reportes

- `sales-by-order` y `payments` con los mismos filtros: `payments.totals.byMethod` (solo PAID) coincide con `sales-by-order.totals.methods` cuando se piden los mismos `from`, `to`, `cashierId`, `method`, `source`, `waiterId`, `tableId`, `zoneId`, hora y día, y no se usan filtros que solo existen en una de las dos (por ejemplo `status`, `productName` o `minAmount`). Una diferencia posible: `payments` filtra la fecha por cada pago y `sales-by-order` por el cierre de la cuenta (último pago), así que un pago de una cuenta que cerró otro día cae en rangos distintos.
- `sales-by-hierarchy` suma líneas de cuentas completas. Con filtros a nivel de pago (`cashierId`, `method`, `source`) la jerarquía incluye toda la cuenta si alguno de sus pagos cumple, mientras que `sales-by-order` solo suma los pagos que cumplen. Coinciden cuando la cuenta se pagó entera con un solo cajero, medio y origen; difieren en cuentas divididas entre cajeros o medios (la jerarquía las cuenta completas) y en las limitaciones de M2 (pagos parciales, líneas canceladas después de cobrar). Los filtros de mesero, mesa, zona, hora y día son a nivel de cuenta y sí cuadran.
- Con reembolsos (doc 32 y 33): `sales-by-order.totals.refunded` y `net` son la referencia. `sales-by-method`, `sales-by-staff`, `sales-by-time`, `summary-kpis` y `tips.totals.returned` (propina) dan los mismos valores para los mismos filtros, y `sales-by-hierarchy.refunds.consumption` también. Sin filtros propios del cierre (`timeFrom`, `timeTo`, `weekdays`, `status`, `minTotal`, `maxTotal`, `hasTip`, `minTip`, `q`, `productId`, `productName`, `categoryPath`), el total de `sales-by-order` es igual al del reporte `refunds` (`totals.consumption` y `totals.tip`) filtrado con `method`, `cashierId`, `source`, `waiterId`, `tableId` y `zoneId`, y también a `suma(payments.rows.refunded) + payments.otherPeriod.refunded`. Con filtros propios del cierre solo cuentan los reembolsos de las cuentas elegibles y `otherPeriod.included` es `false`.

## Rendimiento

- `sales-by-order`: 2 consultas en paralelo (página con los pagos embebidos en JSON y totales con conteo de cuentas), antes eran 4 en dos tandas. Más 2 de acceso (rol y zona horaria). `payments`: 2 consultas. `detail`: 3 en paralelo. `filter-options`: 1.
- Las cuentas elegibles llevan un pre-filtro redundante (`EXISTS` de un pago PAID dentro del rango) para que Postgres pueda arrancar desde el índice de `payments(paid_at, status)` en vez de recorrer todas las cuentas de la sucursal.
- `q` usa `ILIKE '%texto%'` sobre columnas de la cuenta ya acotada por rango; no necesita índice trigram mientras el rango sea razonable.

### Índices recomendados (no se crea migración)

Solo `filter-options` recorre pedidos sin acotar por cuenta; sin este índice escanea todos los pedidos vendidos de la sucursal:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_branch_id_created_at_idx
  ON orders (branch_id, created_at);
```

Opcional si el volumen de pagos crece (permite barrer solo pagos PAID por fecha sin tocar la tabla):

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_paid_paid_at_idx
  ON payments (paid_at) INCLUDE (bill_id) WHERE status = 'PAID';
```

## Verificación

- Unit tests: DTO (válidos, inválidos, límites, texto tipo inyección), `parseReportFilters`, cursores por orden, forma y parametrización del SQL, alcance por rol, detalle, opciones y CSV con filtros.
- El SQL completo (todas las consultas del repositorio, con todos los filtros y todos los órdenes y paginado de punta a punta) se ejecutó contra PGlite (Postgres en WASM) con datos sembrados: ver el informe de la entrega. No se ejecutó contra el Postgres de QA ni con el adaptador real de Prisma.
