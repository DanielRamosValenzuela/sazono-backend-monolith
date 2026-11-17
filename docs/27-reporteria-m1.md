# 27. Reportería M1: medio de pago, cajero y cierre por comanda

Primer hito de la especificación de reportería (`docs/11-spec-reporteria-y-reembolsos.md` del repositorio raíz). Solo cubre captura de datos de cada pago y dos reportes: cierre por comanda y detalle de pagos. No incluye jerarquía de ventas, reembolsos, documentos tributarios ni arqueo de caja.

## Qué se construyó

- Migración aditiva `20261118120000_payment_method_and_reports` (no aplicada: se despliega con `prisma migrate deploy`).
  - Enum `PaymentMethod`: CASH, CREDIT_CARD, DEBIT_CARD, TRANSFER, MERCADO_PAGO, VOUCHER, MACH, OTHER.
  - Columnas nuevas en `payments`: `method` (null = histórico "Sin clasificar"), `staff_user_id` (quien cobró, FK con SET NULL), `tip_amount` (parte de `amount` que es propina, default 0), `source` (WEB_QR, CASHIER o WAITER), `gateway_meta` (JSON).
  - Índices: `bills(branch_id, closed_at)`, `payments(paid_at, status)`, `payments(staff_user_id, paid_at)`.
  - Backfill idempotente: `tip_amount` desde `payment_attempts.tip_amount`; `source = WEB_QR` y, para Mercado Pago, `method = MERCADO_PAGO` en pagos históricos de pasarela. Los pagos MANUAL históricos quedan con `method` null.
- Captura en todos los caminos de creación de pago (todos pasan por `FinalizePaymentService`):
  - Cobro manual de caja (`POST /v1/payments/bills/:billId`): acepta `paymentMethod` opcional (CASH por defecto; CASH, CREDIT_CARD, DEBIT_CARD, TRANSFER, VOUCHER, MACH u OTHER). Guarda `staffUserId` del usuario autenticado y `source` CASHIER (o WAITER si solo tiene rol de mesero, en mesas de mostrador).
  - Transbank (confirmación por redirect y conciliación): VD y VP son DEBIT_CARD; VN, VC, SI, S2, NC y N2 son CREDIT_CARD; cualquier otro código es OTHER. `gateway_meta` guarda `payment_type_code`, `installments`, `authorization_code`, `buy_order` y `childCommerceCode`.
  - Mercado Pago (cobro directo, webhook y conciliación): método MERCADO_PAGO; `gateway_meta` guarda `transactionId`, `payment_type_id`, `payment_method_id` e `installments`.
  - Pagos por QR (orden, cuenta y split): `source = WEB_QR`, sin `staffUserId`.
  - La propina se guarda siempre aparte en `tip_amount`. Consumo = `amount - tip_amount`.
- Corrección de zona horaria en `GET /v1/analytics/branches/:branchId/summary`: "hoy", la serie diaria y los rangos from/to se calculan en la zona horaria del restaurante (America/Santiago), no en la del servidor.
- Módulo `src/modules/reports` con dos endpoints (ver abajo).

## Reglas comunes

- Prefijo real: `/api/v1/reports/branches/:branchId/...`. Requiere token de staff.
- Filtros `from` y `to` obligatorios, formato `YYYY-MM-DD` en la hora del restaurante, ambos inclusivos. Internamente el rango es semiabierto `[from 00:00, to+1 00:00)` en la zona del restaurante. Máximo 366 días (92 días con `format=csv`).
- Roles: ADMIN y SUPERVISOR ven todo. CASHIER solo ve filas donde él cobró, y solo del día de hoy: el servidor fuerza `cashierId` y `from = to = hoy` e ignora lo que venga en la query. WAITER, KITCHEN y BAR reciben 403.
- Dinero: pesos CLP enteros, como string en JSON. En CSV son números sin separador de miles.
- Paginación por cursor opaco (`nextCursor`), `limit` por defecto 50, máximo 200. Los totales siempre cubren todo el filtro, no la página.
- Filtro `method`: lista separada por comas de CASH, CREDIT_CARD, DEBIT_CARD, TRANSFER, MERCADO_PAGO, VOUCHER, MACH, OTHER, SIN_CLASIFICAR. Con este filtro (y con `cashierId`) solo se cuentan los pagos que cumplen; las filas, los totales y las columnas cuadran entre sí.
- CSV: UTF-8 con BOM, separador `;`, saltos `\r\n`, cabeceras en español, fechas `dd-MM-yyyy HH:mm` en la hora del restaurante. Descarga por streaming en lotes de 2000 filas. Los textos que empiezan con `=`, `+`, `-` o `@` se prefijan con `'`.

## GET /reports/branches/:branchId/sales-by-order

Cierre por comanda: una fila por cuenta con estado PAID cuya fecha de cierre cae en el rango y que tiene al menos un pago PAID que cumple los filtros. La fecha de cierre es `bills.closed_at`; si la cuenta está pagada pero la mesa aún no se cierra, se usa la fecha del último pago.

Query: `from`, `to`, `cashierId`, `method`, `cursor`, `limit`, `format=json|csv`. Orden por defecto: cierre descendente. Desde el doc 30 acepta además filtros libres (mesero, mesa, zona, estado, rango de total, propina, origen, hora, día de la semana, búsqueda, producto y categoría) y `orderBy`/`direction`; también hay un endpoint de detalle de comanda y otro de opciones de filtro.

Cada fila trae comanda (número de ticket de mostrador o últimos 6 caracteres del id), caja, mesa, zona, mesero, cajero, comensales, estado de pago (`Pagado` o `Mixto` si hay más de un medio), total, descuentos (0), a pagar, propina, cantidad de pagos, boleta (vacío), reembolsado (0) y `methods`: arreglo de 9 entradas fijas `{ method, amount }`, una por medio más `SIN_CLASIFICAR`. La columna "Caja" es el nombre de quien cobró, `QR/Online` para pagos web y `Sin asignar` para pagos históricos sin cajero.

Invariante: la suma de las columnas de medio de una fila es igual a su `total`, y la suma de las filas es igual a `totals.total` para el mismo filtro. La propina nunca entra en las columnas de medio ni en `total`.

Archivo CSV: `cierre-ventas_{branchId}_{from}_{to}.csv`, con una fila final `TOTAL`.

## GET /reports/branches/:branchId/payments

Detalle de pagos: une los pagos registrados con los intentos de pago sin pago asociado (fallidos, pendientes o cancelados).

Query: `from`, `to`, `kind=payment|attempt|all` (por defecto all), `provider` (MANUAL, MERCADO_PAGO, TRANSBANK), `paymentStatus` (estado del pago o del intento), `cashierId`, `method`, `cursor`, `limit`, `format=json|csv`. Con `cashierId` o `method` solo aparecen pagos (los intentos no tienen cajero ni medio). Orden: fecha del evento descendente (`paidAt` o, si no hay, `createdAt`).

Cada fila trae id, tipo (PAYMENT o ATTEMPT), fechas, comanda, mesa, medio, proveedor, referencia, estado, estado y detalle del proveedor, motivo de falla, monto (consumo, sin propina), propina, total cobrado, caja, cajero, origen y reembolsado (0). Los totales vienen por estado y por medio (este último solo sobre pagos PAID).

Archivo CSV: `pagos_{branchId}_{from}_{to}.csv`.

## Pendiente fuera de M1

Descuentos, boleta y folio, reembolsos, jerarquía de ventas, turnos de caja y reportes por mesero o por hora. Las columnas correspondientes salen en 0 o vacías.
