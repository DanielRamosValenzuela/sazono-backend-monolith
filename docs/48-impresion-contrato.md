# 48. Impresion de comandas: contrato y runbook (backend, hitos P0 a P3)

Diseno completo en `../../docs/48-impresion-de-comandas.md`. Este documento describe lo que el backend implementa hoy. Modulo: `src/modules/printing`. Esquema y migracion `20261129120000_kitchen_printing` ya aplicados; este trabajo no los toca.

## 1. Alcance

Implementado: documento neutro y builder, renderers (ESC/POS, HTML, texto), numeracion diaria unica y creciente, gancho de encolado en `routeOrderToStations`, gancho de anulacion, cola con maquina de estados, transportes SIMULATED y TCP (backend), worker, reconciliador, reimpresion, alertas, config por entorno.

Tambien implementado (P3): API de administracion (seccion 9), protocolo de dispositivo con long-poll, emparejamiento y push de despertar (seccion 10), auditoria (11) y variables nuevas (12).

## 2. Numeracion `#<printCode>-<seq>`

- `PreparationStation.printCode` (1 a 4 caracteres, unico por sucursal) es el prefijo; es configurable. Si una estacion tiene impresoras asignadas y no tiene codigo, se autoasigna el siguiente (`01`, `02`...) la primera vez que se rutea un ticket. Una estacion sin codigo y sin impresoras no se numera: se comporta exactamente como antes.
- `seq`: contador por estacion y dia de negocio en `print_ticket_counters`, incrementado con `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` en autocommit sobre un cliente Prisma propio (`PrismaService.autocommit`, pool de 3 conexiones, separado del pool de los pedidos para no agotarlo), **fuera** de la transaccion del pedido: la fila del contador se bloquea solo durante esa sentencia, asi los pedidos concurrentes de una misma estacion no hacen cola entre si. Los numeros son unicos y estrictamente crecientes por estacion y dia de negocio, pero **puede haber saltos**: si la transaccion del pedido hace rollback o el gancho falla, el numero asignado se pierde. Los numeros de cocina no son fiscales. Minimo 3 digitos, pasa a `#01-1000`.
- Dia de negocio: `BranchSettings.businessDayStartHour` (default 4) en `Restaurant.timezone`. Con 4, las 03:59 pertenecen al dia anterior.
- Se guarda en `StationTicket.displayNumber` y `businessDate`. El tablero lo recibe en `StationTicketResponseDto.displayNumber` (`string | null`, aditivo).

## 3. Encolado (`enqueueStationTicketPrint(tx, stationTicketId)`)

Llamado una sola vez por `routeOrderToStations` con todos los tickets del pedido (`enqueueStationTicketPrints(tx, ids)`; cubre mesero, mostrador y los dos caminos QR). Las lecturas van en lote: una consulta para todos los tickets con sus relaciones, una para las impresoras de todas las estaciones y un `createMany` unico para los trabajos; el numero de cada ticket se pide en paralelo al contador (fuera de la transaccion) y el `PrintJob` se crea dentro de la transaccion con el numero ya asignado. Va dentro de `SAVEPOINT print_hook`: cualquier error (SQL o logica) hace `ROLLBACK TO SAVEPOINT` y se registra como warning; el pedido nunca falla. Por cada impresora activa asignada a la estacion crea un `PrintJob` con `idempotencyKey = ST:<stationTicketId>:P:<printerId>:R0` (`createMany skipDuplicates`). Sin impresoras no crea trabajos.

Anulacion (`voidStationTicketPrint(tx, {stationTicketId} | {orderId}, {reason, actorStaffUserId})`), llamada desde `UpdateStationTicketStatusService` (CANCELLED) y `CancelOrderService` (pedido en produccion), mismo savepoint:

| Estado del trabajo original | Resultado |
|---|---|
| PENDING, FAILED | CANCELLED (`lastError = TICKET_CANCELLED`) |
| CLAIMED, PRINTED | nuevo trabajo `VOID` (`...:VOID`) si `Printer.printVoidSlips` |

Devolver un ticket desde el tablero no imprime.

## 4. Documento y renderers

`ReceiptDocument` v1 (JSON en `PrintJob.document`): `kind COMANDA|VOID|TEST`, `copies`, `header {station, number}`, `meta {printedAtLabel, createdAtIso, placeLabel, staffLabel, customerLabel, orderNotes}`, `banners[]`, `lines[{qty,name,options[],note}]`, `footer.qrPayload`. Sin precios ni datos de pago. Texto saneado a un repertorio latino (`?` para el resto).

El layout (`render/receipt-layout.ts`) es unico y lo comparten los tres renderers; los tests comparan el ticket de referencia contra el cuadro del diseno (32 y 48 columnas):

- `renderText(doc, columns)`: texto plano (cabeceras centradas, `(corte)` al final).
- `renderHtmlFragment/Document(doc, {columns, paperWidthMm, copies})`: `.receipt` con `width: 100%` y `max-width` igual al ancho de pagina en px (58 mm = 219 px, 80 mm = 302 px), `font-size = floor(anchoPx / (columns * 0.6))` px en fuente monoespaciada (32 col/58 mm = 11 px, 48 col/80 mm = 10 px) para que las columnas completas quepan, filas con `overflow: visible`, `@page { size: <mm>mm auto; margin: 0 }`, escapado.
- `renderEscPos(doc, {columns, codepage, escTCodepageId, autoCut, cashDrawer, copies})`: `ESC @`, `ESC t n` (cp437=0, cp850=2, windows1252=16, cp858=19 o el override), negrita `ESC E`, tamano `GS ! 0x11`, corte parcial `ESC d 2` + `GS V 42 00`, pulso de cajon `ESC p 0 25 250`, QR opcional. Encoder propio sin dependencias (CP858 por defecto; n=A4, N=A5 sin verificar con impresora real).

Reglas: cabecera y numero en 2x2 solo si caben en `columns/2`; si no, tamano normal en negrita. En 80 mm el cajero y el cliente comparten linea si caben. Banners agregados al entregar (no se guardan): `** ATRASADA, pedido HH:mm **` (> 10 min; no se agrega en reimpresiones ni en reintentos manuales, que conservan la hora original) y `(REINTENTO)` (intento > 1 tras lease vencido). Reimpresion: `*** REIMPRESO #n ***` + hora y quien. Anulacion: `*** ANULADO ***` 2x2, mismo numero, motivo y quien anulo.

## 5. Cola y maquina de estados

`PENDING -> CLAIMED -> PRINTED`; `CLAIMED -> PENDING` (fallo reintentable con backoff) o `FAILED`; `PENDING|FAILED|CLAIMED -> CANCELLED` por anulacion; `FAILED -> PENDING` por reintento manual.

- `claim({transports?, deviceId?, branchId?, limit, leaseSeconds, claimedBy})`: `WITH due AS (... FOR UPDATE OF j SKIP LOCKED) UPDATE ... attempts = attempts + 1`. Reclama PENDING vencidos y CLAIMED con lease vencido (y `attempts < max`). Con `deviceId` exige `print_device_printers`. Descarta (CANCELLED `TICKET_NOT_PENDING`) solo las comandas **originales** (sin `reprintOfId`, clave `...:R0` y que no vengan de un reintento manual) cuyo ticket ya esta READY o CANCELLED. Las reimpresiones explicitas y los reintentos manuales siempre se imprimen; los VOID y TEST nunca se descartan.
- `ack(jobId, {printedAt?, branchId?})`: `PRINTED | DUPLICATE (duplicateAcks+1) | IGNORED | NOT_FOUND`. Acepta ack tardio desde PENDING/FAILED.
- `fail(jobId, {code, message, retryable, branchId?})`: `PENDING` con backoff (base 5 s, tope 2 min) o `FAILED` tras 6 intentos o si no es reintentable; en FAILED audita `PRINT_JOB_FAILED` y envia push a ADMIN/SUPERVISOR.
- `extend(jobId, branchId?, leaseSeconds?)`: lease de dispositivo 45 s (por defecto). Lease del servidor 30 s.
- `manualRetry(jobId, actor)`: FAILED a PENDING con `attempts = 0`, deja `last_error = 'MANUAL_RETRY'` como marca (`fail()` la conserva como prefijo en los fallos siguientes) y audita `PRINT_JOB_RETRIED`.
- `release(jobIds, deviceId)`: devuelve a PENDING (con `attempts - 1`) los trabajos que un dispositivo reclamo pero cuyo long-poll se cancelo antes de entregarlos.
- Garantia al menos una vez.

## 6. Transportes del servidor y worker

`PrintWorkerService.runOnce()` (cada `PRINTING_WORKER_INTERVAL_MS`, lote `PRINTING_WORKER_BATCH_SIZE`, apagado con `NODE_ENV=test` o `PRINTING_WORKER_ENABLED=false`):

El worker reclama un lote pequeno (`PRINTING_WORKER_BATCH_SIZE`, 10), lo agrupa por impresora y procesa hasta 4 impresoras en paralelo; los trabajos de una misma impresora van en serie. Antes de cada envio renueva el lease (30 s), asi una impresora TCP caida (3 s de timeout por trabajo) no retrasa a las demas ni deja vencer los leases del resto del lote.

- SIMULATED: renderiza, marca PRINTED, impresora ONLINE. El documento queda en `print_jobs.document` para la vista previa del admin (impresora virtual).
- TCP: solo si `PRINTING_TCP_ENABLED=true`. Socket a `connection.host:port` (timeouts conexion 3 s, escritura 5 s). Guardas: puerto 9100-9110; solo IPv4 privadas (10/8, 172.16/12, 192.168/16); se rechazan siempre `0.0.0.0` y `0.0.0.0/8`, `255.255.255.255`, multicast (224/4), reservadas (240/4), CGNAT, `169.254.x.x` y cualquier IPv6 salvo `::1` (solo fuera de produccion); loopback (127/8, `::1`) y `localhost` solo si `NODE_ENV != production`. Los hostnames se resuelven al conectar (todas las respuestas A) y cada IP resuelta se revalida antes de abrir el socket, que se conecta a esa IP y no al nombre (sin DNS rebinding); si alguna resuelve a una direccion no permitida, `TCP_HOST_FORBIDDEN`. Los hosts numericos ambiguos (`2130706433`, `0x7f.1`, `127.1`) se rechazan. Fallo: `fail(retryable)` e impresora OFFLINE con `lastError`.
- APP_BRIDGE, BROWSER, AGENT: pull por dispositivo (seccion 10); el worker no los reclama.

`PrintReconcilerService` (cada `PRINTING_RECONCILE_INTERVAL_MS`): (a) completa comandas de las ultimas 24 h sin trabajo y con impresora, solo si el ticket se creo despues de vincular la impresora a la estacion y de crear la impresora (no es retroactivo al asignar una impresora a mitad del dia); (b) CLAIMED con lease vencido hace mas de 5 min vuelve a PENDING o pasa a FAILED si agoto intentos (cada trabajo que pasa a FAILED dispara `alerts.jobFailed` con `LEASE_EXPIRED`); (c) impresoras de dispositivo sin `lastSeenAt` en 90 s pasan a OFFLINE y toda impresora OFFLINE mas de 2 min alerta (`PRINTER_OFFLINE`, push, una por impresora cada 10 min, en memoria: una sola instancia); (d) retencion: PRINTED/CANCELLED 30 dias, FAILED 90.

`ReprintService.reprintJob(jobId, actor)` (bloquea la fila del `StationTicket` con `SELECT ... FOR UPDATE` dentro de la transaccion: dos toques seguidos obtienen `R1` y `R2`, nunca un 500 por clave duplicada) y `reprintStationTicket(stationTicketId, actor)`: crea `PrintJob` con `reprintOfId`, clave `...:R<n+1>`, audita `PRINT_JOB_REPRINTED`. La autorizacion (ADMIN, SUPERVISOR, KITCHEN, BAR) la hace el controlador.

## 7. Variables de entorno (validadas en `validate-environment.ts`, documentadas en `.env.example`)

| Variable | Default |
|---|---|
| `PRINTING_WORKER_ENABLED` | true |
| `PRINTING_WORKER_INTERVAL_MS` | 2000 |
| `PRINTING_RECONCILE_INTERVAL_MS` | 60000 |
| `PRINTING_WORKER_BATCH_SIZE` | 10 |
| `PRINTING_MAX_ATTEMPTS` | 6 |
| `PRINTING_RETRY_BASE_SECONDS` | 5 |
| `PRINTING_TCP_ENABLED` | false |
| `PRINTING_TCP_CONNECT_TIMEOUT_MS` | 3000 |
| `PRINTING_TCP_WRITE_TIMEOUT_MS` | 5000 |
| `PRINTING_PAIRING_SECRET` | sin valor (usa `PAYMENTS_ENCRYPTION_KEY`; obligatoria una de las dos en produccion; minimo 32 caracteres) |
| `TRUST_PROXY_HOPS` | 0 |
| `DB_POOL_MAX` | 10 (conexiones del pool principal; el cliente autocommit mantiene su pool de 3) |
| `DB_TX_MAX_WAIT_MS` | 10000 (espera maxima para obtener conexion de una transaccion interactiva) |
| `DB_TX_TIMEOUT_MS` | 15000 (duracion maxima de una transaccion interactiva) |

Capacidad de rafaga de pedidos: cada pedido es una transaccion interactiva que ocupa una conexion de principio a fin, asi que la concurrencia util es ~`DB_POOL_MAX` y el resto espera hasta `DB_TX_MAX_WAIT_MS`; si no hay conexion a tiempo Prisma responde P2028 ("Unable to start a transaction in the given time"). Con la BD remota de QA (~10 s por pedido por la latencia de red) el E2E vio P2028 por encima de ~16 pedidos en paralelo con pool 10 y maxWait 5 s; con una BD en la misma region el pedido tarda una fraccion de eso y la misma configuracion absorbe muchas mas rafagas. Subir `DB_POOL_MAX` solo ayuda si el limite de conexiones del pooler/BD lo permite (sumar el pool autocommit de 3 por instancia) y `DB_TX_TIMEOUT_MS` debe seguir por encima de la duracion real de un pedido.

## 8. Runbook

- Una comanda no sale: revisar `print_jobs` del ticket (`status`, `attempts`, `last_error`). PENDING con `next_attempt_at` futuro es backoff; FAILED requiere `manualRetry` o reimpresion. Sin fila: la estacion no tiene impresora activa asignada; el reconciliador la crea en menos de un minuto si se asigna despues.
- Enie o acentos rotos: cambiar `Printer.codepage` (cp858, windows1252, cp850, cp437) o `escTCodepageId`; aplica tambien a trabajos pendientes porque los bytes se generan al entregar. Imprimir una hoja `TEST` (`buildTestDocument`).
- TCP no conecta: confirmar `PRINTING_TCP_ENABLED=true`, que el backend alcanza la IP (un servidor en la nube no ve `192.168.x.x`), puerto 9100-9110 y el codigo de error en `last_error` (`TCP_HOST_FORBIDDEN`, `TCP_CONNECT_TIMEOUT`, `ECONNREFUSED`).
- Numeracion: la autoasignacion de `printCode` toma `pg_advisory_xact_lock(hashtext(branchId))`, por lo que dos estaciones que reciben su primer ticket a la vez obtienen codigos distintos.
- Numeros saltados: el contador se asigna fuera de la transaccion del pedido, asi que un rollback del pedido o un fallo del gancho dejan un hueco. Es esperado y no es un error; solo importan repetidos o decrecientes.
- Doble papel: `duplicate_acks` y el banner `(REINTENTO)` lo delatan; la entrega es al menos una vez.
- Verificacion: `npx tsc --noEmit`, `npx jest src/modules/printing`. La concurrencia del contador se prueba con una base simulada en memoria (no hay Postgres en los tests, por eso no hay test de integracion automatizado); la prueba real contra Postgres queda para el E2E de QA, con las verificaciones SQL de la seccion 8.1.

### 8.1 Verificaciones SQL manuales (E2E de QA)

Ejecutar en la base de QA tras disparar muchos pedidos a la vez (por ejemplo 30 pedidos simultaneos a la misma estacion y los primeros tickets de dos estaciones nuevas a la vez):

```sql
-- Sin repetidos por (estacion, dia) y sin numeros fuera del rango del contador: 0 filas (los saltos son esperados).
SELECT preparation_station_id, business_date, count(*) AS tickets,
       max(split_part(display_number, '-', 2)::int) AS max_seq,
       count(DISTINCT display_number) AS distintos
FROM station_tickets WHERE display_number IS NOT NULL
GROUP BY 1, 2
HAVING count(*) <> count(DISTINCT display_number);

-- Codigos de impresion unicos por sucursal: 0 filas.
SELECT branch_id, print_code, count(*) FROM preparation_stations
WHERE print_code IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;

-- El contador nunca queda por debajo de los tickets emitidos ni del mayor numero usado: 0 filas.
SELECT c.preparation_station_id, c.business_date, c.last_seq, count(t.*)
FROM print_ticket_counters c
LEFT JOIN station_tickets t ON t.preparation_station_id = c.preparation_station_id
                           AND t.business_date = c.business_date
GROUP BY 1, 2, 3 HAVING c.last_seq < count(t.*);

-- Claves de trabajo repetidas (reimpresiones concurrentes): 0 filas.
SELECT idempotency_key, count(*) FROM print_jobs GROUP BY 1 HAVING count(*) > 1;

-- Reclamos colgados y trabajos con reintentos o acks duplicados (revisar a mano).
SELECT id, status, claimed_by_device_id, lease_until, attempts FROM print_jobs
WHERE status = 'CLAIMED' AND lease_until < now() - interval '10 minutes';
SELECT id, attempts, duplicate_acks FROM print_jobs WHERE duplicate_acks > 0 OR attempts > 1;
```

Con dos dispositivos sobre la misma impresora, cada `print_jobs.id` debe quedar `PRINTED` una sola vez y `duplicate_acks` en 0 salvo caidas provocadas.

## 9. API de administracion (JWT staff)

Base: `/api/v1/branches/:branchId/print`. Auth: `Authorization: Bearer <jwt staff>`. Todas las rutas verifican `BranchAccessService.ensureAccess` sobre `branchId`; un id de otra sucursal responde 404 (no se filtra su existencia). "R" = ADMIN y SUPERVISOR leen; "W" = solo ADMIN. Errores: `{ statusCode, message, code? }` (400 validacion, 403 rol, 404, 409 conflicto, 429 throttling).

### 9.1 Impresoras

| Metodo y ruta | Rol | Request | Response |
|---|---|---|---|
| `GET /printers` | R | | `Printer[]` |
| `POST /printers` | W | `CreatePrinter` | 201 `Printer` |
| `GET /printers/:printerId` | R | | `Printer` |
| `PATCH /printers/:printerId` | W | `UpdatePrinter` (parcial) | `Printer` |
| `DELETE /printers/:printerId` | W | | 204. Borra tambien el historial de trabajos de la impresora (cascade); la UI lo avisa y sugiere desactivar. Borrar una impresora borra tambien su historial de trabajos (`PrintJob.printer` es `onDelete: Cascade`): no se cancelan ni quedan filas. La auditoria `PRINTER_DELETED` registra `after.removedJobs` (cantidad de trabajos eliminados). Para conservar el historial hay que desactivarla (`PATCH active=false`). 409 `PRINTER_HAS_OPEN_JOBS` solo si hay trabajos CLAIMED (en curso) |
| `PUT /printers/:printerId/stations` | W | `{ stationIds: uuid[] }` (reemplaza) | `Printer` |
| `POST /printers/:printerId/test` | W | | 202 `{ jobId }` (trabajo `TEST`, clave `TEST:<uuid>`). 409 `PRINTER_INACTIVE` |

`CreatePrinter`: `name` (1-60, unico por sucursal, 409), `transport` (`SIMULATED | TCP | APP_BRIDGE | BROWSER | AGENT`; `CLOUDPRNT` responde 400), `connection?`, `paperWidthMm?` (58|80), `columns?` (32|35|42|48), `codepage?` (`cp858|cp850|cp437|windows1252`), `escTCodepageId?` (0-255 o null), `copies?` (1-5), `autoCut?`, `cashDrawer?`, `printVoidSlips?`, `active?`, `stationIds?`. Defaults: 58 mm, 32 columnas, `cp858`, 1 copia, corte automatico. Una estacion de otra sucursal responde 400.

`connection` por transporte (se normaliza y valida; el resto de claves se descarta):

| Transporte | connection |
|---|---|
| `SIMULATED`, `BROWSER`, `AGENT` | `{}` |
| `TCP` (lo abre el backend) | `{ "host": "192.168.1.50", "port": 9100 }`. Puerto 9100-9110, IPv4 privada o hostname; 169.254.x.x y publicas rechazadas; loopback y `localhost` solo si `NODE_ENV != production` |
| `APP_BRIDGE` (la abre la tablet) | `{ "via": "tcp", "host": "192.168.1.50", "port": 9100 }` o `{ "via": "bluetooth", "address": "AA:BB:CC:DD:EE:FF" }`. En `tcp` rige la misma guarda que en `TCP`: puerto 9100-9110, solo IPv4 literal privada (10/8, 172.16/12, 192.168/16) o `localhost`/loopback fuera de produccion; hostnames, 169.254.x.x y publicas se rechazan. Se valida al crear/actualizar y otra vez al armar el trabajo para el dispositivo (conexion invalida: el trabajo falla con `INVALID_CONNECTION`, no retryable) |

Cambiar el `transport` de una impresora la desvincula de todos sus dispositivos.

`Printer`: `{ id, branchId, name, transport, connection, paperWidthMm, columns, codepage, escTCodepageId, copies, autoCut, cashDrawer, printVoidSlips, active, status (UNKNOWN|ONLINE|OFFLINE|ERROR), lastSeenAt, lastError, stationIds[], deviceIds[] }`.

### 9.2 Estaciones y codigo de impresion

| Metodo y ruta | Rol | Request | Response |
|---|---|---|---|
| `GET /stations` | R | | `PrintStation[]` |
| `PATCH /stations/:stationId` | W | `{ printCode?: string \| null, printerIds?: uuid[] }` | `PrintStation` |

`PrintStation`: `{ stationId, name, stationType, printCode, printerIds[] }`. `printCode` (1-4 letras o numeros, se guarda en mayusculas, `null` lo quita y se autoasigna el siguiente `01`, `02`... al primer ticket) es el prefijo configurable de `#<printCode>-<seq>`; repetido en la sucursal responde 409 `PRINT_CODE_TAKEN`. Afecta solo a las comandas nuevas. `printerIds` reemplaza las impresoras de la estacion.

### 9.3 Dia de negocio

`PATCH /api/v1/branches/:branchId` (endpoint existente, ADMIN) acepta `settings.businessDayStartHour` (entero 0-23, default 4). Las respuestas de sucursal incluyen `settings.businessDayStartHour`.

### 9.4 Trabajos, reimpresion y vista de comanda

| Metodo y ruta | Rol | Request | Response |
|---|---|---|---|
| `GET /jobs` | R | query `status?`, `kind?` (`COMANDA|VOID|TEST`), `printerId?`, `stationTicketId?`, `from?`, `to?`, `before?` (ISO; pagina por `createdAt` menor), `limit?` (1-100, default 50) | `PrintJob[]`, mas recientes primero |
| `GET /jobs/:jobId` | R | | `PrintJob & { document }` |
| `GET /jobs/:jobId/preview` | R | | `Preview` del trabajo con la configuracion actual de su impresora |
| `GET /preview/sample` | R | query `printerId?`, `stationId?`, `columns?` (32|35|42|48), `paperWidthMm?` (58|80) | `Preview` de una comanda de ejemplo (usa el `printCode` de la estacion y el ancho pedido; no guarda nada) |
| `POST /jobs/:jobId/reprint` | ADMIN, SUPERVISOR, KITCHEN, BAR | | 201 `PrintJob` nuevo (`reprintOfId`, clave `...:R<n+1>`, banner `*** REIMPRESO #n ***`). Solo trabajos `COMANDA`: una hoja `VOID` responde 409 `Las hojas de anulacion no se reimprimen.` y una `TEST` (que no tiene ticket) 409 `Solo se reimprimen comandas.` (el tipo se valida antes que el ticket) |
| `POST /station-tickets/:stationTicketId/reprint` | ADMIN, SUPERVISOR, KITCHEN, BAR | | 201 `PrintJob[]` (uno por impresora). 404 si el ticket no tiene trabajos |
| `POST /jobs/:jobId/retry` | ADMIN, SUPERVISOR | | `PrintJob`. 409 `PRINT_JOB_NOT_RETRYABLE` si no esta `FAILED` |

`PrintJob`: `{ id, printerId, printerName, stationTicketId, kind, status (PENDING|CLAIMED|PRINTED|FAILED|CANCELLED), displayNumber ("#01-023"), stationName, attempts, duplicateAcks, reprintOfId, reprintNumber (n de la clave `:R<n>`, null en originales), claimedByDeviceId, lastError, createdAt, nextAttemptAt, printedAt }`.

`Preview`: `{ jobId | null, status | null, columns, paperWidthMm, text, html, htmlDocument, document }`. `text` es el render ASCII, `html` el fragmento `<div class="receipt">` (el contenido viene escapado), `htmlDocument` una pagina completa con `@page` lista para un iframe, y `document` el `ReceiptDocument` JSON (panel de soporte). No incluye precios ni medios de pago.

### 9.5 Dispositivos de impresion

| Metodo y ruta | Rol | Request | Response |
|---|---|---|---|
| `GET /devices` | R | | `PrintDevice[]` |
| `POST /devices` | W | `{ name?, kind? (default BROWSER), printerIds? }` | 201 `{ device, pairingCode, expiresAt }` |
| `POST /devices/:deviceId/pairing-code` | W | | `{ device, pairingCode, expiresAt }`; invalida el token vigente (re-emparejar) |
| `PATCH /devices/:deviceId` | W | `{ name?, printerIds? }` | `PrintDevice` |
| `DELETE /devices/:deviceId` | W | | `PrintDevice` con `active=false`; su token deja de funcionar al instante. En la misma transaccion los trabajos `CLAIMED` por ese dispositivo vuelven a `PENDING` (lease limpiado, `attempts` no consume el intento del reclamo, `last_error = DEVICE_REVOKED`) sin esperar al reconciliador (5 min); la auditoria `PRINT_DEVICE_REVOKED` registra `after.releasedJobs`. Igual con `DELETE /print/device/self` |

`pairingCode`: 6 digitos, se muestra una sola vez, vigencia `PRINTING_PAIRING_TTL_MINUTES` (10), un solo uso; en la base solo queda su HMAC-SHA256 con la clave `PRINTING_PAIRING_SECRET` (o `PAYMENTS_ENCRYPTION_KEY` si falta; en produccion se exige una de las dos). Cambiar la clave invalida los codigos vigentes. El dispositivo, al emparejarse, informa su `kind`, `name` y `appVersion` y estos reemplazan los del admin. `PrintDevice`: `{ id, branchId, kind (ANDROID_APP|BROWSER|AGENT), name, active, paired, pairingPending, pairingExpiresAt, appVersion, lastSeenAt, online (latido en los ultimos 90 s), printerIds[] }`; nunca expone el hash del token.

Impresoras que puede atender cada tipo de dispositivo (se valida al asignar): `BROWSER` solo transporte `BROWSER`; `ANDROID_APP` transportes `APP_BRIDGE` y `BROWSER`; `AGENT` transporte `AGENT`. Un restaurante con tablet y otro con PC usan el mismo flujo y las mismas tablas.

## 10. Protocolo de dispositivo

Base: `/api/v1/print/device`. Auth (todas menos `pair`): `Authorization: Device <token>`. El token son 32 bytes aleatorios (43 caracteres base64url), se devuelve una vez en `pair` y en el servidor solo existe su SHA-256. No es el JWT del staff y no vence; se revoca desde el admin (`DELETE /devices/:id`) o con `DELETE /print/device/self`. El throttle de las rutas con token se calcula por dispositivo (hash del token) y no por IP, para que varios dispositivos detras de un proxy no compartan cupo; `pair` y el resto de la API siguen por IP. Con proxy inverso poner `TRUST_PROXY_HOPS=1` (hoy se aplica a `trust proxy` en `main.ts`). Toda consulta filtra por la sucursal del dispositivo y por las impresoras que atiende: un dispositivo nunca ve ni confirma trabajos de otra sucursal ni de impresoras que no atiende (404). Token ausente, mal formado, desconocido o revocado: 401.

| Metodo y ruta | Throttle | Request | Response |
|---|---|---|---|
| `POST /pair` (sin auth) | 5/min por IP, y fallos de emparejamiento limitados por IP (10) y por codigo (5) en una ventana de 5 min (en memoria de la instancia). Al bloquear responde 429 `{ code: "PAIRING_THROTTLED", retryAfterSeconds }` con la cabecera `Retry-After` (segundos hasta que el bloqueo mas largo aplicable se levanta) | `{ code: "123456", name, kind, appVersion? }` | 200 `{ deviceId, token, branchId, printers: DevicePrinter[] }`. 400 `PAIRING_CODE_INVALID` (inexistente, vencido o usado) |
| `GET /me` | 30/min | | `{ deviceId, branchId, kind, name, printers, availablePrinters }` |
| `PUT /printers` | 30/min | `{ printerIds: uuid[] }` | `{ printers }`. "Esta pantalla imprime": reemplaza las impresoras atendidas; 400 si alguna no existe en la sucursal o su transporte no corresponde al tipo de dispositivo |
| `POST /heartbeat` | 12/min | `{ appVersion?, printers?: [{ printerId, ok, detail? }] }` | `{ ok: true, serverTime }`. Cada 20-30 s |
| `GET /jobs/next?wait=25` | 90/min | `wait` 0-55 s, con tope `PRINTING_LONGPOLL_MAX_SECONDS` (25) | 200 `{ jobs: DeviceJob[] }` (hasta 5) o 204 sin cuerpo tras esperar |
| `POST /jobs/:id/ack` | 120/min | `{ printedAt? }` | `{ result: "PRINTED" \| "DUPLICATE" \| "IGNORED" }`; 404 si el trabajo no es de una impresora que atiende |
| `POST /jobs/:id/fail` | 120/min | `{ code, message, retryable }` | `{ result: "PENDING" \| "FAILED" \| "IGNORED" }`; 404 si el trabajo no esta reclamado por este dispositivo |
| `POST /jobs/:id/extend` | 120/min | | `{ extended, leaseUntil }`; 404 si no es su reclamo |
| `DELETE /self` | 5/min | | 204 |

`DevicePrinter`: `{ id, name, transport, connection, paperWidthMm, columns, copies, autoCut, status }`. `connection` es lo que la app necesita para llegar a la impresora (host y puerto, o direccion Bluetooth); el servidor la revalida y entrega `{}` si no pasa la guarda.

`DeviceJob`:

```json
{
  "jobId": "uuid",
  "printerId": "uuid",
  "printerName": "Cocina",
  "kind": "COMANDA",
  "displayNumber": "#01-023",
  "station": "pizza",
  "attempt": 1,
  "leaseUntil": "2026-11-25T17:32:45.000Z",
  "copies": 1,
  "cut": true,
  "retryUncertain": false,
  "connection": { "via": "tcp", "host": "192.168.1.50", "port": 9100 },
  "escposBase64": "G0A...",
  "html": "<!doctype html>..."
}
```

El servidor renderiza todo: el cliente no conoce el documento ni la codepage. `escposBase64` va para el plugin nativo (APP_BRIDGE); `html` (pagina completa, `@page` del ancho de la impresora) para `window.print()` en un iframe oculto (BROWSER). `copies` es informativo: las copias ya vienen dentro de los bytes y del HTML, el cliente no debe repetir. `retryUncertain=true` significa que un intento anterior pudo haber impreso (el papel lleva `(REINTENTO)`).

Flujo del cliente (identico en tablet y PC):

1. `POST /pair` la primera vez y guardar el token (`@capacitor/preferences` en Android; `localStorage` con try/catch en navegador). Luego `GET /me` al arrancar.
2. Bucle: `GET /jobs/next?wait=25`. Con 200, por cada job: imprimir; si sale bien `POST ack`; si falla `POST fail` con `retryable` (true para errores transitorios como Bluetooth desconectado o impresora apagada). Si imprimir tarda mas de unos 30 s, `POST extend`. Con 204, repetir de inmediato. Ante error de red, esperar 2-5 s y repetir; ante 401, borrar el token y pedir emparejar de nuevo.
3. En paralelo, `POST /heartbeat` cada 20-30 s con el estado real de cada impresora (`ok=false` si el plugin no la alcanza). Sin latido en 90 s sus impresoras pasan a OFFLINE.
4. Al recibir el push FCM de datos `{ type: "PRINT_WAKE", branchId }`, disparar un ciclo de `jobs/next` de inmediato si el bucle esta dormido.

Comportamiento del cliente web y Android (sazono-ui):
- Acks: se descartan solo con 400, 401, 403, 404 o 409; con 408, 429, 0 (sin red) o 5xx se reintentan y se guardan en la cola local de acks pendientes (maximo 50).
- Push `PRINT_WAKE`: solo despierta el bucle, no muestra notificacion local. `order.created` despierta y muestra la notificacion.
- Transporte BROWSER: no se ofrece en la app nativa (`window.print` no hace nada en el WebView); ahi el trabajo falla con `NO_TRANSPORT`. En PC la impresion silenciosa requiere Chrome con `--kiosk-printing`; sin esa bandera aparece el dialogo y el lease se mantiene con `extend` mientras este abierto (hasta 5 min). Si el dialogo se cancela no siempre es detectable y el trabajo puede quedar como impreso.
- Pantalla despierta: el bucle llama `EscposPrinter.keepAwake` al iniciar en nativo y lo libera al terminar.
- Modo vista previa: da cada comanda por impresa sin papel; se desactiva solo a las 4 horas y se avisa en el indicador de cocina y en el panel del dispositivo.

### 10.1 Garantias

- Reclamo atomico: `WITH due AS (... FOR UPDATE OF j SKIP LOCKED) UPDATE ... SET status='CLAIMED', lease_until=now()+45 s, attempts=attempts+1`. Con dos dispositivos sobre la misma impresora cada trabajo lo recibe uno solo. El reclamo solo ve impresoras vinculadas al dispositivo, de su sucursal, activas y de un transporte que su tipo atiende.
- Lease de 45 s (`extend` lo renueva). Un trabajo `CLAIMED` con lease vencido y menos de `PRINTING_MAX_ATTEMPTS` intentos vuelve a poder reclamarse (por el mismo o por otro dispositivo) y sale con `(REINTENTO)`; el reconciliador lo devuelve a `PENDING` o lo pasa a `FAILED` si agoto los intentos.
- Al menos una vez, no exactamente una: si un dispositivo imprime y muere antes del `ack`, otro puede reimprimir. El primer `ack` gana; uno tardio devuelve `DUPLICATE` y suma `duplicateAcks`. Un `ack` tardio sobre un trabajo que el lease devolvio a `PENDING` se acepta.
- `fail` solo lo acepta el dispositivo que tiene el reclamo; `retryable=false` o intentos agotados dejan el trabajo en `FAILED` (alerta a ADMIN y SUPERVISOR) y se recupera con `POST /jobs/:id/retry` o reimprimiendo.
- Si el `StationTicket` ya esta `READY` o `CANCELLED` al reclamar, la comanda original no se entrega (`CANCELLED`, `TICKET_NOT_PENDING`); las reimpresiones, los reintentos manuales y las hojas `VOID` y `TEST` siempre se entregan.
- Long-poll: espera hasta `wait` segundos revisando la base cada 2 s y despertando al instante con una senal en memoria de la sucursal (la senal se emite al detectar trabajos nuevos, al reimprimir, reintentar o imprimir una prueba). Si el cliente corta la conexion la espera termina; si la corta justo despues de reclamar, los trabajos se liberan (`release`) en vez de esperar al vencimiento del lease. Con varias instancias del backend funciona el sondeo cada 2 s.
- Despertar por FCM: el scheduler detecta trabajos nuevos (o reintentos que vencen) de impresoras de dispositivo y envia un mensaje de datos de alta prioridad, sin `notification`, a los tokens FCM de los usuarios KITCHEN y BAR de la sucursal (maximo uno cada 3 s por sucursal). No toca los canales ni sonidos de los avisos visibles existentes (`sazono_alerts`, `sazono_silent`). Si el push no llega, el long-poll lo encuentra igual.

## 11. Auditoria

`PRINTER_CREATED`, `PRINTER_UPDATED`, `PRINTER_DELETED`, `PRINT_STATION_UPDATED`, `PRINT_TEST_ENQUEUED`, `PRINT_JOB_REPRINTED`, `PRINT_JOB_RETRIED`, `PRINT_JOB_FAILED`, `PRINTER_OFFLINE`, `PRINT_DEVICE_PAIRING_CREATED`, `PRINT_DEVICE_PAIRED` (con IP), `PRINT_DEVICE_UPDATED`, `PRINT_DEVICE_REVOKED`. Nunca se registra un token ni un codigo de emparejamiento.

## 12. Variables de entorno nuevas

| Variable | Default | Uso |
|---|---|---|
| `PRINTING_PAIRING_TTL_MINUTES` | 10 (1-60) | Vigencia del codigo de emparejamiento |
| `PRINTING_LONGPOLL_MAX_SECONDS` | 25 (1-55) | Espera maxima de `GET /print/device/jobs/next` |
| `PRINTING_WAKE_PUSH_ENABLED` | true | Push FCM de datos que despierta a los dispositivos |

## 12.1 Limitaciones conocidas

- App Android en segundo plano: el E2E mostro que si la app queda en segundo plano mas de ~1 minuto el bucle de impresion del WebView se detiene (Android congela timers y red) y los trabajos quedan `CLAIMED` hasta que la app vuelve al primer plano; entonces se imprimen con `attempts` 2 (el lease de 45 s vencio y se reclamo de nuevo). Mitigacion actual: el panel "Esta pantalla imprime" muestra en la app nativa el aviso "Mantenga la app abierta y la pantalla encendida para imprimir", y al volver a primer plano (`visibilitychange`, que el WebView de Capacitor emite al reanudar) el cliente aborta el long-poll en curso, abre un ciclo de reclamo inmediato y envia un heartbeat. Solucion de fondo: hito P5b (seccion 13), un servicio nativo en primer plano que imprime con la pantalla apagada.
- El tablero de cocina permite reimprimir con `POST /station-tickets/:stationTicketId/reprint` (solo si el ticket ya tiene trabajos); el cliente pide confirmacion solo cuando la ultima comanda ya salio impresa.

## 13. Hito P5b: servicio nativo en primer plano (plan tecnico, no implementado)

Problema: hoy el bucle de impresion vive en el WebView. Con la pantalla apagada o la app en segundo plano Android congela el WebView y los timers, y solo el push `PRINT_WAKE` (si llega) lo despierta. P5b mueve el bucle a un `Service` nativo para imprimir con la pantalla apagada.

Diseno:
- `PrintForegroundService` (Kotlin, `foregroundServiceType="dataSync"`; en Android 14+ declarar el permiso `FOREGROUND_SERVICE_DATA_SYNC`; evaluar `connectedDevice` si se imprime por Bluetooth). Un hilo corre el mismo bucle del cliente web: `GET /print/device/jobs/next?wait=25` con `Authorization: Device <token>` (HttpURLConnection u OkHttp, timeout de lectura 35 s), imprime con la misma logica que `EscposPrinterPlugin` (se extrae a un objeto `EscposTransport` compartido: TCP y Bluetooth), y luego `POST ack` o `POST fail` con `retryable`. Mientras imprime y pasan mas de 30 s, `POST extend`. `POST heartbeat` cada 20-30 s con el estado real de las impresoras. Mismo protocolo y mismas garantias del punto 10 (lease de 45 s, al menos una vez, 401 borra el token y detiene el servicio).
- Credenciales: la capa web ya guarda el token con `@capacitor/preferences` (SharedPreferences `CapacitorStorage`). El servicio lee de ahi el token, la URL base del API y los `printers` de `GET /me` (con `connection`). Se anade un metodo del plugin `startPrintService({ apiBase })` / `stopPrintService()` que la web llama al emparejar, al cambiar impresoras y al cerrar sesion; el servicio se reinicia solo con `START_STICKY` y tras reinicio del equipo con un `BOOT_COMPLETED` receiver (opcional).
- Notificacion: canal nuevo `sazono_print_service` (importancia LOW, sin sonido) con notificacion persistente "Imprimiendo comandas" y accion para detener. No toca `sazono_alerts` ni `sazono_silent`. Android 13+ requiere el permiso `POST_NOTIFICATIONS` (ya se pide para las alertas).
- Bateria: `PARTIAL_WAKE_LOCK` solo durante la impresion (no todo el long-poll), y pedir la exencion de optimizacion con `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (permiso `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) desde el panel "Esta pantalla imprime", con una guia por fabricante (Xiaomi, Samsung, Huawei) para el arranque automatico. Sin la exencion Doze puede retrasar la red; el push FCM de alta prioridad sigue siendo la red de seguridad: al recibir `PRINT_WAKE` el servicio dispara un ciclo inmediato aunque no este corriendo.
- Relacion con el bucle web (evitar doble reclamo): un dispositivo emparejado = un solo bucle. Con el servicio activo la web NO corre `jobs/next`: consulta `getPrintServiceStatus()` al arrancar y se limita a mostrar el estado (impresoras, ultimo trabajo) leyendo `GET /me`, y a `keepAwake` deja de ser necesario. Si el servicio no esta disponible (permiso negado, web/PC), la web mantiene su bucle actual. Aunque coexistieran, el reclamo atomico (`SKIP LOCKED`) evita imprimir dos veces el mismo trabajo: el riesgo real es solo que el segundo bucle consuma el trabajo y falle por falta de transporte, por eso la exclusion se hace con una bandera de modo guardada en Preferences y el servicio es quien manda. El modo vista previa y el transporte BROWSER siguen siendo solo web.
- Pruebas: emulador TCP (`npm run printer:emulator`) con pantalla apagada (`adb shell input keyevent 26`), app en segundo plano, Doze forzado (`adb shell dumpsys deviceidle force-idle`), y matar el proceso para verificar el reinicio.

Esfuerzo estimado: 5 a 7 dias. Servicio y bucle nativo con ack/fail/extend/heartbeat 2 a 3 dias; extraer el transporte compartido y el puente web (start/stop/status) 1 dia; notificacion, permisos y exencion de bateria con guias por fabricante 1 dia; pruebas en dispositivos reales (Doze, fabricantes, Bluetooth) 1 a 2 dias.

## 13. Estado de impresion en el tablero de cocina

`GET /api/v1/kitchen/station-tickets` (y la respuesta de `POST .../status`) agregan a cada ticket el campo aditivo `print`:

```json
{ "print": { "status": "NONE | PENDING | PRINTED | FAILED", "lastJobId": "uuid | null", "printerOffline": false } }
```

- `status` se calcula con el ultimo trabajo `COMANDA` **por impresora** del ticket (mas reciente por `createdAt`, incluye reimpresiones; los `CANCELLED` se ignoran) y se agrega: `FAILED` si alguno esta `FAILED`; si no, `PENDING` si alguno esta `PENDING`/`CLAIMED`; si no, `PRINTED` si alguno esta `PRINTED`; sin trabajos, `NONE`. Asi en una estacion con varias impresoras un fallo no queda oculto por un trabajo posterior impreso en otra. `lastJobId` es el primer trabajo (mas reciente) con el estado resultante (sirve para `POST /print/jobs/:id/reprint` o `retry`).
- `printerOffline`: alguna impresora activa asignada a la estacion del ticket tiene `status = OFFLINE`.
- Se calcula en lote para todos los tickets de la lista: una consulta de trabajos (`distinct` por ticket e impresora) y una de impresoras OFFLINE por estaciones, sin N+1. Si falla, el tablero responde igual con `NONE` y se registra un warning.
- La respuesta de reimpresion no cambia (ya devuelve el `PrintJob` con su `status`).
