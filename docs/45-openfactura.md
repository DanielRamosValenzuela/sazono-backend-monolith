# 45 - Documentos tributarios con OpenFactura: contrato y runbook

Fecha: 2026-11-19. Implementa lo investigado en `docs/43-openfactura-integracion.md`. Codigo en `src/modules/tax-documents` (modulo aislado, extraible a un servicio Nest propio) y puentes minimos en `src/modules/billing` y `src/modules/payments`. Si algun dia se reemplaza el proveedor por un servicio DTE propio (`docs/44`), solo cambia el adaptador `OpenFacturaTaxDocumentProvider`: el puerto, el outbox, el worker y los endpoints no.

## 1. Decisiones

| Tema | Decision |
|---|---|
| Aislamiento | `tax-documents` nunca lee `orders`, `bills`, `payments` ni `refunds`. El monolito entrega un **snapshot inmutable** (`TaxDocument.requestSnapshot`) construido por los puentes `billing/application/enqueue-boleta.ts` y `enqueueCreditNoteForRefund` (en `create-pending-credit-note.service.ts`). La unica escritura hacia el monolito es `RefundCreditNoteSync`, que marca `Refund.creditNoteStatus = ISSUED` y `creditNoteFolio`. |
| Emision asincrona (outbox) | La fila `TaxDocument PENDING` se crea **en la misma transaccion** del evento de negocio. Un worker la emite fuera de la transaccion. Un fallo del proveedor jamas bloquea cobros ni reembolsos. |
| Disparo de boleta | Cuando una cuenta pasa a `PAID` (`settleBillIfFullyPaid`, usado por todos los cobros y por descuentos que cierran la cuenta) y el restaurante tiene una cuenta de proveedor `ACTIVE`: una boleta afecta (39) por el **consumo neto de descuentos**. IVA incluido, `computeVatBreakdown`. |
| Propina | **No va en la boleta** (opcion A de `docs/43` seccion 4, que la dejaba abierta para el contador). Se guarda en `TaxDocument.tipAmount` y en `snapshot.tip`, nunca en el DTE. Verificar con el contador y con una boleta real del piloto antes de produccion. |
| Nota de credito | Cuando un reembolso pasa a `SUCCEEDED` (efectivo/manual inmediato, TX2 de pasarela, "marcar manual", reembolso externo conciliado desde el webhook de Mercado Pago), la cuenta tiene boleta `PENDING` o `ISSUED` y la parte de consumo (`amount - tipAmount`) es mayor a 0: una NC (61) que referencia la boleta por el consumo reembolsado. Se permiten NC parciales (una por reembolso). |
| Sin proveedor activo | Comportamiento identico al de antes: no se crean filas, `creditNoteStatus` queda `PENDING`. Si la cuenta no tiene boleta (se pago antes de activar el proveedor), el reembolso tampoco genera NC: queda `PENDING` para emitirla a mano. |
| Un solo puerto | `TAX_DOCUMENT_PROVIDER` (`TaxDocumentProviderPort`: `verifyCredentials`, `emit`, `getStatus`, `fetchPdf`). Reemplaza el puerto y el `NoopTaxDocumentProvider` antiguos de `billing`, que no tenian usos. |
| Credenciales | API key por restaurante en `RestaurantTaxProviderAccount.apiKeyCipher`, cifrada con `SecretCipherService` (AES-256-GCM, AAD `OPENFACTURA:{restaurantId}`, clave `PAYMENTS_ENCRYPTION_KEY`). Ninguna API la devuelve y no se loguea. Una sola cuenta activa por restaurante: `PUT` desactiva las demas. |

## 2. Maquina de estados

```
PENDING --(emitido + estado Aceptado)--> ISSUED
PENDING --(error permanente | estado Rechazado | dependencia rechazada)--> REJECTED
PENDING --(error reintentable | estado Pendiente)--> PENDING (attempts+1, nextAttemptAt = ahora + backoff)
PENDING --(attempts == max)--> PENDING con nextAttemptAt NULL y lastError  => "requiere reintento manual"
```

- Backoff: `TAX_DOCUMENTS_RETRY_BASE_SECONDS * 2^(intento-1)`, maximo 1 hora; respeta `Retry-After` de un 429 si es mayor, con tope duro de 12 h (siempre bajo la ventana de 24 h del proveedor).
- **Ambiente fijado al documento**: `enqueueTaxDocument` guarda `environment` (`SANDBOX`/`PRODUCTION`) dentro de `requestSnapshot` al encolar (boleta y NC). El worker resuelve la cuenta activa **de ese ambiente**; si no existe, reintenta con `[NO_ACTIVE_ACCOUNT] ... en {ambiente}` y nunca emite en el otro. Documentos antiguos sin `environment` usan la cuenta activa. `PUT tax-provider` que cambia de ambiente responde `409 TAX_PROVIDER_ENVIRONMENT_HAS_PENDING_DOCUMENTS` si quedan `PENDING` del ambiente anterior.
- **Ventana de idempotencia**: si un documento sin `providerDocId` tiene mas de 20 h desde `createdAt`, el worker NO emite (la deduplicacion de 24 h podria haber expirado y OpenFactura no ofrece busqueda por `Idempotency-Key` ni por referencia; con token se consulta el estado normalmente). Lo deja `PENDING`, `nextAttemptAt = NULL`, `lastError = REQUIRES_MANUAL_REVIEW_DEDUPE_WINDOW` y audita `TAX_DOCUMENT_NEEDS_MANUAL_RETRY`. `POST retry` responde `409 TAX_DOCUMENT_REQUIRES_MANUAL_REVIEW` en ese caso: revisar el panel de OpenFactura; si el documento existe, cargarlo a mano; si no, usar `reissue`.
- Un fallo inesperado dentro de `processOne` cuenta como intento (`[INTERNAL_ERROR]`), con backoff, y tras `maxAttempts` queda en reintento manual.
- `needsManualRetry` en la API = `PENDING` con `nextAttemptAt = null`. Se alerta con `TAX_DOCUMENT_NEEDS_MANUAL_RETRY` en `audit_logs` y con `stuckDocuments` en `GET .../tax-provider`.
- Despues de emitir, el documento guarda `providerDocId` (token), `folio` y `timbre` de inmediato y consulta el estado. Mientras el proveedor diga `Pendiente`, el worker solo consulta el estado (no vuelve a emitir): ese es el "polling de documentos PENDING en el proveedor".
- Errores de autenticacion (401/403, `OF-03`) **nunca rechazan** el documento: se reintenta y se escribe `lastErrorMessage` en la cuenta, para que el ADMIN pueda pegar otra key y reintentar.
- Una NC no se emite hasta que su boleta este `ISSUED` (el SQL de claim lo exige). Si la boleta queda `REJECTED`, la NC se rechaza con `REFERENCE_NOT_ISSUED`. Mientras la boleta esta `PENDING`, la NC espera sin gastar intentos.
- Un `REJECTED` sin `providerDocId` (nunca llego al proveedor) y un `PENDING` agotado admiten reintento manual. Si el rechazo fue `MISSING_FISCAL_DATA`, el reintento reconstruye la parte `emitter` del snapshot con los datos fiscales actuales del restaurante (no los montos).
- Un `REJECTED` con token fue rechazado por el SII: no se reintenta. `POST /v1/tax-documents/:id/reissue` (ADMIN, solo boletas `REJECTED` o en revision por ventana de idempotencia) la marca `VOIDED` (libera el indice unico de boleta activa), encola una boleta nueva con clave `boleta:{billId}:2` (luego `:3`...), emisor y fecha actuales y el ambiente de la cuenta activa, y audita `TAX_DOCUMENT_REISSUED`.
- `markIssued` actualiza el documento y `Refund.creditNoteStatus/creditNoteFolio` en una sola transaccion; cada corrida del worker re-sincroniza reembolsos cuya NC esta `ISSUED` pero el reembolso no (hasta 50).

### Worker

`TaxDocumentWorkerService.runOnce()` corre cada `TAX_DOCUMENTS_WORKER_INTERVAL_MS` (`TaxDocumentsScheduler`, apagado con `NODE_ENV=test`, sin solaparse consigo mismo). El **claim** es una sola sentencia SQL: selecciona hasta `BATCH_SIZE` filas `PENDING` vencidas con `FOR UPDATE SKIP LOCKED` (boletas antes que NC) y les mueve `next_attempt_at` 120 s hacia adelante (lease). Antes de procesar cada fila el worker renueva su lease (y la omite si ya no esta `PENDING`), de modo que un lote lento no deja filas con el lease vencido para otra instancia. Dos instancias nunca toman la misma fila y si una muere a mitad, la fila vuelve a estar disponible al vencer el lease. El proveedor recibe `Idempotency-Key = TaxDocument.idempotencyKey` (`boleta:{billId}` / `credit-note:{refundId}`), asi que un reintento tras un corte no duplica el documento.

## 3. Contrato OpenFactura verificado en el sandbox

Verificado el 2026-11-19 contra `https://dev-api.haulmer.com` con la key demo publica de `docs/43` y datos ficticios (empresa demo `76795561-8`; nunca RUTs ni datos de clientes reales). Resuelve la pregunta abierta 4 de `docs/43`.

### Generales

- Base `/v2/dte`, header `apikey`. Key invalida: `401 {"statusCode":401,"message":"Access denied due to invalid subscription key..."}` (gateway, sin `error.code`).
- Errores del servicio: `{"error":{"message","code","details":[{"field","issue"}]}}`. Codigos vistos: `OF-02` faltan campos obligatorios (400), `OF-03` contribuyente desactivado/no coincide con la key (401), `OF-06` idempotencia (400), `OF-08` validacion de esquema (400), `OF-10` / `OF-10.1` validacion de campos o montos (400), `OF-22` problema interno (400/500).
- Rate limit: `429 {"statusCode":429,"message":"Rate limit is exceeded. Try again in 1 seconds."}`. El cliente aplica ademas un limitador local por key (3 req/s, 100 req/min, `rate-limiter.ts`); si la espera superaria 30 s, devuelve un 429 local y el documento se reintenta luego.
- **El sandbox siempre emite con la empresa demo.** Si el `RUTEmisor` no corresponde a la key, `OF-03`. Por eso, en `SANDBOX` el adaptador toma el emisor de `GET /organization` (cache 10 min) y no del restaurante; en `PRODUCTION` usa los datos fiscales del snapshot.
- Folios disponibles: `GET /organization/document` -> `{"documentos":[{"dte":39,"disponibles":N,"vencimiento":"..."}]}`. `PUT tax-provider` lo consulta al verificar la key.

### Emision `POST /v2/dte/document`

Body `{ "response": ["FOLIO","TIMBRE","PDF"], "dte": { Encabezado, Detalle, [Referencia] } }`, header `Idempotency-Key`.

- Sin `response` la respuesta trae **solo `TOKEN`** (sin folio). Se piden siempre `FOLIO` y `TIMBRE` (base64 PNG, se guarda en `timbre`). Se pide tambien `PDF`: generarlo despues con `GET .../pdf` tarda 11-17 s y falla con `OF-22` la primera vez; emitido con la orden, queda disponible al instante. Como el worker es asincrono, el costo no se nota. El base64 del PDF y del timbre no se guardan en `rawResponse`.
- Exito: `200 {"TOKEN","FOLIO","TIMBRE","PDF","WARNING"?}`. Reintento con la misma `Idempotency-Key`: `400 OF-06` con `details:[{field:"token",issue:"<token>"}]` y **sin folio**; el adaptador lo trata como exito (`replayed`) y obtiene el folio al consultar el estado (`GET /document/{token}/json`).
- El orden de los tags importa (error `OF-08` "se espera uno del tipo ..."). No se aceptan tags desconocidos.
- Las fechas son `YYYY-MM-DD`; el sandbox acepta fechas pasadas o futuras (produccion es del SII: usar la fecha local del restaurante, que es lo que hacemos).

#### Boleta afecta (`TipoDTE 39`), montos brutos con IVA

```
IdDoc:    TipoDTE=39, Folio=0, FchEmis, IndServicio=3        (IndMntNeto NO se envia: montos brutos)
Emisor:   RUTEmisor, RznSocEmisor, GiroEmisor, [CdgSIISucur], DirOrigen, CmnaOrigen, [CiudadOrigen]
          (NO acepta Acteco)
Receptor: RUTRecep ("66666666-6" consumidor final) [, RznSocRecep, CorreoRecep, DirRecep, CmnaRecep...]
          (NO acepta GiroRecep; un RUT con DV invalido da OF-02 "RUTRecep Requerido")
Totales:  MntNeto, IVA, MntTotal
Detalle[]: NroLinDet, NmbItem, QtyItem (>0), PrcItem (bruto), [DescuentoMonto], MontoItem
```

- `MontoItem` debe ser `QtyItem * PrcItem - DescuentoMonto`; si no, `OF-10 "Error en el item Nº: 1 /6000"`. El descuento de la cuenta va como `DescuentoMonto` por linea (usamos `BillItem.discountAmount`). `DscRcgGlobal` tambien se acepta, pero `DescuentoMonto` deja el detalle cuadrado.
- `IndExe=1` en una linea exige `MntExe` en `Totales`; hoy no se usa (monto exento 0).
- `MontoNF` y lineas de propina "exentas" funcionan en el esquema, pero **no se usan**: la propina queda fuera del DTE.
- No admite `Referencia` de documentos (solo `CodVndor`, `CodCaja`).
- `NmbItem` se limita a 80 caracteres (el SII lo exige aunque el sandbox acepte mas). Si las lineas no suman el consumo, el snapshot cae a una sola linea "Consumo restaurante".
- `Totales.MntTotal` mal calculado no siempre falla en boleta (sandbox lo toleraba), por eso el snapshot valida `neto + IVA = total` antes de encolar.

#### Nota de credito (`TipoDTE 61`), esquema de factura: montos netos

```
IdDoc:    TipoDTE=61, Folio=0, FchEmis                       (IndMntNeto NO es valido)
Emisor:   RUTEmisor, RznSoc, GiroEmis, Acteco, DirOrigen, CmnaOrigen, [CiudadOrigen]   (Acteco obligatorio)
Receptor: RUTRecep, RznSocRecep                              (alcanza con consumidor final)
Totales:  MntNeto, TasaIVA=19, IVA, MntTotal                 (valida el total: OF-10 "Monto erroneo : 4000/5000")
Detalle:  [{NroLinDet:1, NmbItem:"Devolucion de consumo", QtyItem:1, PrcItem:neto, MontoItem:neto}]  (QtyItem obligatorio)
Referencia: [{NroLinRef:1, TpoDocRef:39, FolioRef, FchRef, CodRef, RazonRef (max 90)}]  (OF-10.1 si falta)
```

- `CodRef`: **3** (corrige montos) para NC parcial, **1** (anula documento) cuando el reembolso cubre el total de la boleta. Pendiente de confirmar con el contador (`docs/43` seccion 7, punto 8).
- El sandbox no valida que `FolioRef` exista. Produccion si lo hara el SII: por eso la NC espera a que la boleta este `ISSUED` y usa su folio real y su fecha de emision (`snapshot.issueDate` de la boleta).
- La NC es por el **consumo** reembolsado (`netAmount`/`vatAmount` del reembolso, que ya excluyen propina). La propina reembolsada no genera NC.

### Consulta y descarga

| Operacion | Endpoint | Respuesta |
|---|---|---|
| Estado | `GET /document/{token}/status` o `/document/{rut}/{tipo}/{folio}/status` | `{"estado":"Aceptado","token"|"folio"}` (`Aceptado`, `Aceptado con Reparo`, `Pendiente`, `Rechazado`); folio inexistente: `400 OF-22` |
| JSON | `GET /document/{token}/json` | `{"json":{Encabezado,Detalle},"token","FchRecepSII","FchRecepOF"}` (usado para recuperar el folio tras `OF-06`) |
| PDF | `GET /document/{token}/pdf` | `{"pdf":"<base64>"}` (60 s de timeout y un reintento) |
| XML | `GET /document/{token}/xml` | `{"xml":"<base64 ISO-8859-1>"}` (no se guarda; `xmlUrl` queda null) |
| Cedible | `.../cedible` | `400 "Documento sin cedible"` en boletas |

## 4. API

Todos los endpoints exigen JWT de staff. `{branchId}` es la sucursal sobre la que el usuario tiene el rol.

| Metodo y ruta | Rol | Descripcion |
|---|---|---|
| `GET /v1/branches/:branchId/tax-provider` | ADMIN | Estado enmascarado: `configured`, `status`, `environment`, `apiKeyConfigured`, `lastVerifiedAt`, `lastErrorMessage`, `missingFiscalData[]`, `pendingDocuments`, `stuckDocuments`. Nunca la key. |
| `PUT /v1/branches/:branchId/tax-provider` | ADMIN | Body `{ apiKey, environment: SANDBOX \| PRODUCTION }`. Verifica la key contra el proveedor (`GET /organization`), cifra y guarda, desactiva otras cuentas, audita `TAX_PROVIDER_CONNECTED`. `400 TAX_PROVIDER_INVALID_API_KEY`, `400 TAX_PROVIDER_RUT_MISMATCH` (produccion: la key es de otro RUT), `400 TAX_FISCAL_DATA_INCOMPLETE` (+ `missing[]`, produccion), `502 TAX_PROVIDER_UNAVAILABLE`, `503` sin `PAYMENTS_ENCRYPTION_KEY`. Throttle 5/min. |
| `DELETE /v1/branches/:branchId/tax-provider` | ADMIN | Desactiva el proveedor (`TAX_PROVIDER_DISCONNECTED`). Los documentos `PENDING` quedan esperando y agotaran intentos si no se reactiva. |
| `GET /v1/branches/:branchId/tax-documents?billId=&status=&limit=` | ADMIN, SUPERVISOR, CASHIER | Documentos de la sucursal (max 100, default 50). |
| `GET /v1/branches/:branchId/bills/:billId/tax-documents` | ADMIN, SUPERVISOR, CASHIER | Documentos de una cuenta: `status`, `folio`, `needsManualRetry`, `canRetry`, `hasPdf`, `pdfUrl`, `lastError`, montos como string. |
| `POST /v1/tax-documents/:id/reissue` | ADMIN | Boleta `REJECTED` (o en `REQUIRES_MANUAL_REVIEW_DEDUPE_WINDOW`): la anula (`VOIDED`) y encola una nueva con otra clave de idempotencia. `409 TAX_DOCUMENT_NOT_REISSUABLE`, `409 TAX_PROVIDER_NOT_ACTIVE`. Throttle 5/min. |
| `POST /v1/tax-documents/:id/retry` | ADMIN | Pone el documento en `PENDING` con `attempts=0` y `nextAttemptAt=ahora`. `409 TAX_DOCUMENT_NOT_RETRYABLE`. Audita `TAX_DOCUMENT_RETRY_REQUESTED`, `TAX_DOCUMENT_REISSUED`. Throttle 10/min. |
| `GET /v1/tax-documents/:id/pdf` | ADMIN, SUPERVISOR, CASHIER | Proxy: baja el PDF del proveedor con las credenciales del restaurante y lo entrega (`application/pdf`, `Cache-Control: private, no-store`). Nunca expone una URL ni la key. `409` si no esta emitido. `502` si el proveedor falla. Throttle 20/min. |

Auditoria (`audit_logs`): `TAX_PROVIDER_CONNECTED`, `TAX_PROVIDER_DISCONNECTED`, `TAX_DOCUMENT_ISSUED`, `TAX_DOCUMENT_REJECTED`, `TAX_DOCUMENT_NEEDS_MANUAL_RETRY` (actor nulo, los escribe el worker) y `TAX_DOCUMENT_RETRY_REQUESTED`.

### Reportes

`sales-by-order` ya leia la boleta `ISSUED` mas reciente de la cuenta (`Boleta` / `N° boleta`): con el worker emitiendo, esas columnas se llenan solas con el folio real. El detalle de comanda agrega `taxDocuments[]` (tipo, estado, folio, fecha, monto, `refundId`, `hasError`; el texto crudo de `lastError` ya no se expone en reportes, solo en `/tax-documents` para los roles de lectura) y `creditNoteFolio` en cada reembolso.

## 5. Configuracion

| Variable | Default | Descripcion |
|---|---|---|
| `OPENFACTURA_SANDBOX_BASE_URL` | `https://dev-api.haulmer.com` | URL base (validada, sin `/v2/dte`). |
| `OPENFACTURA_PRODUCTION_BASE_URL` | `https://api.haulmer.com` | Idem produccion. |
| `OPENFACTURA_TIMEOUT_MS` | 15000 | Timeout por llamada (el PDF usa 60 s). |
| `TAX_DOCUMENTS_WORKER_ENABLED` | true | Apagado siempre con `NODE_ENV=test`. |
| `TAX_DOCUMENTS_WORKER_INTERVAL_MS` | 15000 | Minimo 1000. |
| `TAX_DOCUMENTS_WORKER_BATCH_SIZE` | 10 | 1 a 100 documentos por corrida. |
| `TAX_DOCUMENTS_MAX_ATTEMPTS` | 8 | 1 a 50. Luego: reintento manual. |
| `TAX_DOCUMENTS_RETRY_BASE_SECONDS` | 30 | Base del backoff exponencial. |
| `PAYMENTS_ENCRYPTION_KEY` | - | Ya existente. Sin ella no se puede conectar un proveedor. |

Validadas en `src/common/config/validate-environment.ts`; ejemplo en `.env.example`.

## 6. Runbook

**Conectar un restaurante (piloto)**
1. Completar datos fiscales del restaurante (`taxId`, `legalName`, `businessActivity`, `legalAddress`, `legalCommune`, `economicActivityCode`). `GET tax-provider` lista `missingFiscalData`.
2. Con la key del titular (nunca por chat/correo), `PUT tax-provider` en `SANDBOX` primero y cobrar una cuenta de prueba: debe aparecer una boleta `ISSUED` con folio en `GET .../bills/:billId/tax-documents` y su PDF.
3. Reembolsar parcialmente esa cuenta: una NC `ISSUED` con `referenceCode 3` y `Refund.creditNoteStatus = ISSUED`.
4. Pasar a `PRODUCTION` (otra key, mismo endpoint). El RUT de la key debe coincidir con `taxId`.

**Documentos atascados** (`stuckDocuments > 0`)
1. `GET .../tax-documents?status=PENDING` y revisar `lastError`.
2. `[NETWORK]`, `[RATE_LIMITED]`, `[HTTP_5xx]`, `[OF-22]`: el proveedor estaba caido; `POST /v1/tax-documents/:id/retry`.
3. `[AUTH]`/`[OF-03]`: key invalida o revocada; `PUT tax-provider` con la nueva key y luego reintentar.
4. `[NO_ACTIVE_ACCOUNT]`: el proveedor fue desactivado; reconectar y reintentar.
5. `REJECTED` con `[MISSING_FISCAL_DATA]`: completar los datos del restaurante y usar `POST retry`; reconstruye el emisor del snapshot con los datos actuales.
   - `REJECTED` con token (rechazo del SII): `POST reissue`.
   - `REQUIRES_MANUAL_REVIEW_DEDUPE_WINDOW`: buscar la boleta en el panel de OpenFactura por monto y fecha; si existe, no reemitir; si no, `POST reissue`.
6. `REJECTED` con `[OF-10]`/`[OF-08]`: error de mapeo; abrir un bug con el `lastError` y el snapshot.
7. `[DUPLICATE_FOLIO]`: el proveedor devolvio un folio ya guardado; escalar.

**Reconciliar** : `GET /organization/document` (via `PUT` o el panel) para vigilar folios restantes de 39 y 61; el reporte `sales-by-order` contra el Z diario del restaurante.

**Reintento seguro**: como el proveedor deduplica por `Idempotency-Key` durante 24 h y el worker guarda el token apenas lo recibe, reintentar un documento ya emitido solo consulta su estado. Pasadas 20 h sin token guardado el sistema ya no reemite solo: pasa a revision manual (ver seccion 2).

## 7. Limites conocidos y pendientes

- La propina se omite del DTE hasta la respuesta del contador (`docs/43` pto. 8) y hay que verificar con una boleta real que el total cobrado vs el de la boleta se acepte.
- El sandbox no prueba aceptacion del SII ni la validez del timbre.
- `CodRef` 1 vs 3 y el plazo maximo de una NC contra boleta estan por confirmar con el contador.
- Receptor: hoy siempre consumidor final (`66666666-6`); el snapshot ya soporta `receiver {rut,name}` cuando exista captura de RUT en la caja.
- El PDF se baja del proveedor en cada descarga (no se guarda copia propia ni el XML): si Haulmer deja de retenerlos, hay que persistirlos (`xmlUrl`/`pdfUrl` ya existen en el esquema).
- Los reembolsos de cuentas pagadas antes de activar el proveedor no generan NC automatica.
- Si se anula un descuento y la cuenta vuelve de `PAID` a `PARTIALLY_PAID` despues de emitida la boleta, la boleta no se corrige sola: se corrige con NC manual.
