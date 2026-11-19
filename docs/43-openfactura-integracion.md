# 43 - Integracion OpenFactura (boleta 39/41 y nota de credito 61)

Fecha: 2026-11-19. Alcance: investigacion y diseno, sin codigo. Complementa `docs/37-proveedor-boleta-electronica.md` (comparacion de proveedores) y `docs/36-preparacion-tributaria.md` (decisiones tributarias, en `../docs/` del repo raiz).

Convencion: **(V)** = lo lei en una pagina oficial de OpenFactura/Haulmer; **(T)** = fuente de terceros (repos, comparadores), consistente pero no oficial; **(NV)** = no verificado. Las paginas oficiales de referencia (`docsapi-openfactura.haulmer.com`, Postman Documenter) no se pudieron leer completas: cargan por JavaScript y el fetch solo devolvio el titulo. Los nombres de campos de la seccion 4 salen de un ejemplo oficial (V), del estandar del SII y de analisis de terceros (T); hay que contrastarlos con la coleccion Postman antes de codificar.

## 1. Respuesta directa: el sandbox es gratis?

**Si, el ambiente de desarrollo no tiene costo y no pide cuenta** (T, con respaldo parcial oficial): `https://dev-api.haulmer.com` (prefijo `/v2/dte`) acepta una API key demo publica que Haulmer publica en su propia pagina de API (V: el ejemplo curl de `openfactura.cl/factura-electronica/api/` usa `apikey: 928e15a2d14d4a6292345f04960f4bd3` contra `dev-api.haulmer.com`). Un analisis de terceros (T, invoicerr #909) dice que hay dos llaves publicas para empresas demo (Haulmer SPA y Hosty SPA), con CAF simulado: el timbre no es valido ante el SII y lo emitido no llega al SII. Sirve para probar mapeo JSON, polling y errores, no para aceptacion real del SII.

Limites: (a) la pagina de precios no menciona sandbox ni prueba gratuita (V); (b) el sandbox es de empresas demo, **no con el RUT del restaurante**; (c) la API key real (produccion) **solo existe despues de contratar y terminar la certificacion SII** (V, help.haulmer.com). Costo real: ver seccion 2.

## 2. Precios de produccion (V, openfactura.cl/factura-electronica/precios, consultado 2026-11-19)

| Concepto | Valor |
|---|---|
| Plan Pyme (ventas mensuales promedio < 200 MM CLP) | 360.000 CLP/ano + IVA |
| Plan Grandes (> 200 MM) | 1.200.000 CLP/ano + IVA |
| Incluido | Emision ilimitada de documentos (sin cobro por documento), boleta electronica y exenta, usuarios ilimitados, **acceso API ilimitado**, habilitacion y certificacion, migracion, 1 razon social |
| Razon social adicional | 360.000 CLP/ano + IVA |
| Firma electronica simple (si no tiene) | 11.790 (1 ano), 16.790 (2), 19.790 (3) |
| Pago inicial | 371.790 + IVA (primera anualidad + firma 1 ano); renovacion 371.790 + IVA |

Equivale a ~30.000 CLP/mes + IVA por restaurante. Partners: existe programa de reventa ("Se nuestro Partner", haulmer.com/partners/precios, V en doc 37); no hay modelo multi-emisor por API publicado. Cotizar a ventas (NV) si Sazono quiere revender o negociar precio por volumen.

## 3. Documentacion, autenticacion y endpoints

- Docs oficiales: `https://docsapi-openfactura.haulmer.com/` (Postman Documenter, V enlace). Ayuda: `help.haulmer.com/hc/apis/...`. Changelog: haulmer.com/articulos/changelog-openfactura (V, ultima entrada de API es de 2020).
- Hosts: produccion `https://api.haulmer.com`, desarrollo `https://dev-api.haulmer.com`, prefijo `/v2/dte` (T).
- Auth: header `apikey` (V en ejemplo oficial). 401 = key invalida, 403 = credenciales invalidas (T).
- Idempotencia: header `Idempotency-Key` aceptado en la emision (V en ejemplo oficial); vigencia 24 h; un reintento devuelve 400 con codigo `OF-06` y el token del documento ya emitido (T, dos fuentes concordantes).
- Rate limit: 3 req/s y 100 req/min globales, 429 con tiempo de reintento (T).
- Webhooks: **no hay** documentados; estado y recepcion por polling (T; el comparador Folyo dice que el sitio no los detalla).

| Operacion | Endpoint | Fuente |
|---|---|---|
| Emitir | `POST /v2/dte/document` con `{ response: [...], dte: {...} }` | V (ejemplo) |
| Estado / XML / JSON / PDF / cedible | `GET /v2/dte/document/{rut}/{tipo}/{folio}/status` (y `/xml`, `/json`, `/pdf`, `/cedible`); variante por token | T |
| Folios disponibles por tipo | `GET /v2/dte/organization/document` | T |
| Emitidos / recibidos / RCV | `POST /v2/dte/document/received`, `POST /v2/dte/registry/sync-rcv` | T |
| Nota de credito | Misma emision `POST /v2/dte/document` con `TipoDTE: 61` y bloque `Referencia`; no hay endpoint de anulacion de boleta (solo `anularDTE52` para guias) | T/NV |

Respuesta de emision: con `response` pidiendo `XML`, `PDF`, `TIMBRE` (opciones adicionales `LOGO`, `FOLIO`, `RESOLUCION`, `LETTER`, variantes 80mm) devuelve esos campos en base64; sin `response` devuelve solo el token (V ejemplo; T detalle). El XML viene en ISO 8859-1. El PDF consume ~60% del tiempo de emision: conviene pedirlo despues (T). Estados de un emitido: `Aceptado`, `Pendiente`, `Aceptado con Reparo`, `Rechazado` (T); no se ven motivos de rechazo (NV).

## 4. Campos de boleta 39/41 y nota de credito 61

> **Actualizacion 2026-11-19:** los nombres de campos, el orden de tags y los errores de esta seccion se verificaron contra el sandbox y quedaron documentados en `docs/45-openfactura.md` seccion 3. Diferencias importantes con lo supuesto aqui: la boleta usa `RznSocEmisor`/`GiroEmisor` y **no** acepta `Acteco`; la NC usa el esquema de factura (`RznSoc`, `GiroEmis`, `Acteco` obligatorio, montos netos, `TasaIVA`); la boleta no acepta `Referencia`; y la implementacion deja la **propina fuera de la boleta** (opcion A).

Ejemplo oficial (V) usa `TipoDTE: 33` con `Encabezado { IdDoc, Emisor, Receptor, Totales }` y `Detalle[]`. Para boleta el SII usa un esquema distinto (`EnvioBOLETA_v11.xsd`, T: el CLI no oficial indica que OpenFactura trata la boleta con otro esquema que la factura). Campos segun estandar SII (facturacion.cl/manualintegracion, y LibreDTE) y por confirmar en Postman de OpenFactura:

- `IdDoc`: `TipoDTE` (39 o 41), `Folio` (0 = asignar por la plataforma, V ejemplo), `FchEmis`, `IndServicio` (3 = boleta de ventas y servicios), `IndMntNeto` (opcional; sin el, los montos de linea son **brutos con IVA**, que es como Sazono guarda precios; con `2` los montos son netos).
- `Emisor`: RUT, razon social, giro, actividad (`Acteco`), direccion y comuna, `CdgSIISucur` opcional. En boleta los nombres de tag son `RznSocEmisor`/`GiroEmisor` (SII, NV en OpenFactura).
- `Receptor`: consumidor final con RUT generico `66666666-6` (NV); con RUT real solo si el cliente lo pide (`receiverRut`/`receiverName` ya existen en `TaxDocument`).
- `Totales`: boleta afecta `MntNeto`, `IVA`, `MntTotal` (+ `MntExe` si hay exento); boleta exenta 41: `MntExe` y `MntTotal`. Ojo: en el estandar de boleta `IndMntNeto=2` condiciona la presencia de `MntNeto`/`IVA`.
- `Detalle[]` (1 a 1000 lineas): `NroLinDet`, `NmbItem`, `QtyItem`, `PrcItem`, `MontoItem`, `IndExe` (1 = exento, para lineas exentas en boleta afecta).
- Propina: no es venta ni parte del neto/IVA (decision doc 36). Opcion A: fuera de la boleta (cobro aparte, solo informado en el ticket). Opcion B: linea con `IndExe` o monto no facturable (`MontoNF`, estandar SII) (NV). **Pregunta pendiente para el contador (doc 36 punto 4)**; hasta responder, emitir la boleta solo por el consumo y registrar la propina en `TaxDocument.tipAmount`.
- Nota de credito 61 (esquema de factura, T): `IdDoc.TipoDTE=61`, `Referencia[] { NroLinRef, TpoDocRef (39/41), FolioRef, FchRef, CodRef (1 anula, 2 corrige texto, 3 corrige montos), RazonRef }`. Hay campos de referencia en boletas desde 2020 (V changelog). El SII acepta NC contra boleta (NV el plazo maximo).

## 5. Multi-tenant

- **Una API key por contribuyente (RUT)**: "Openfactura solo genera una API Key por Contribuyente" (T, dos fuentes); no hay selector de tenant ni cabecera de emisor (T). La key la genera solo el titular del servicio, en Configuracion > API > GENERAR API KEY (V).
- Una cuenta OpenFactura puede tener varias razones sociales pagando 360.000/ano cada una (V precios), pero no se publica que una sola key emita por varios RUT (NV).
- **Conclusion de diseno:** cada restaurante contrata su OpenFactura (o Sazono contrata una razon social adicional a nombre de ese RUT), genera su API key y la entrega a Sazono; Sazono la guarda **cifrada por restaurante**. Pedir a Haulmer por escrito si Partners permite emitir multi-RUT con una credencial de integrador (Open question 1).

## 6. Prerrequisitos SII y que cubre OpenFactura

| Requisito SII | Lo hace OpenFactura? |
|---|---|
| Representante legal con clave SII, actividad y direccion vigentes | No: lo aporta el restaurante (doc 37) |
| Firma electronica / certificado digital | Vende firma simple (11.790/ano) (V); subir un certificado propio por API: NV |
| Postulacion, set de pruebas de boleta, declaracion de cumplimiento, resolucion | Si: "Habilitacion y certificacion" incluida en el plan (V). El plazo del SII (10-15 dias habiles segun doc 37) corre igual |
| CAF (folios 39, 41 y 61) | Lo gestiona la plataforma ("CAF automatico" segun FAQ, T; los terminos mencionan subir CAF: NV). Folios disponibles por `GET /organization/document` |
| Envio al SII y RCOF/RVD | NV: confirmar que OpenFactura envia el RVD diario (doc 37 pregunta 4) |
| Conservacion del XML | Emision devuelve el XML en base64; guardar copia propia (ver seccion 9) |

## 7. Checklist: que debe hacer el dueno (por restaurante)

1. Decidir quien paga: ~30.000 CLP/mes + IVA por restaurante (371.790 + IVA el primer ano). Sugerencia: traspasar en el fee mensual o cobrar alta (decision del dueno).
2. Para empezar el desarrollo **no hace falta contratar nada**: usar la key demo del sandbox. Solo contratar cuando se vaya a probar con un RUT real.
3. Elegir restaurante piloto y reunir: RUT, razon social, giro, codigo de actividad, direccion/comuna, **clave SII del representante legal**, firma electronica (o comprar la simple), sin pendientes en el SII.
4. Contratar el plan Pyme en openfactura.cl (con ese RUT como razon social) y pedir al equipo de habilitacion la certificacion de boleta 39/41 y NC 61.
5. Esperar el set de pruebas y la declaracion de cumplimiento del SII (semanas); confirmar con Haulmer que los folios reales 39/41/61 estan cargados.
6. Con la certificacion terminada, el titular entra a Configuracion > API > **GENERAR API KEY** y la entrega a Sazono por canal seguro (se pega en el panel de admin de Sazono; nunca por chat/correo).
7. Pedir a Haulmer por escrito: multi-RUT con una credencial de integrador, webhooks, envio de RVD, limites de rate para produccion y precio Partners por volumen.
8. Resolver con el contador: propina en boleta, codigo de referencia de la NC (1 total / 3 parcial), plazo para NC, RUT generico, conservacion del XML.
9. Emitir 10 a 20 boletas y 2 NC de bajo monto en el RUT piloto y cuadrar con el Z diario.

## 8. Mapeo Sazono -> OpenFactura

| Origen Sazono | Destino OpenFactura (`dte`) | Nota |
|---|---|---|
| `Restaurant.taxId` | `Encabezado.Emisor.RUTEmisor` (sin puntos, con guion) | Normalizar con `chilean-rut.ts` |
| `Restaurant.legalName`/giro (`businessActivity`), `legalAddress` | `RznSoc`, `GiroEmis`, `DirOrigen`, `CmnaOrigen`; `Acteco` (falta campo) | `Acteco` y comuna requieren campos nuevos |
| `TaxDocument.type` BOLETA_AFECTA / BOLETA_EXENTA / NOTA_CREDITO | `TipoDTE` 39 / 41 / 61 | |
| `TaxDocument.id` | Header `Idempotency-Key` | Estable entre reintentos (24 h); pasado ese plazo, consultar por folio/token antes de reemitir |
| `Bill`/`Payment.paidAt` (zona del restaurante) | `FchEmis` | Fecha local, no UTC |
| `Payment` consumo = `amount - tipAmount` | `Totales.MntTotal` | Precios con IVA incluido => montos brutos, sin `IndMntNeto` |
| `TaxDocument.netAmount` / `vatAmount` | `Totales.MntNeto` / `IVA` | Calculados por `computeVatBreakdown`; deben cuadrar con el DTE |
| `TaxDocument.exemptAmount` | `Totales.MntExe` (41) | Hoy 0 |
| `TaxDocument.tipAmount` | No va (opcion A) o `MontoNF` (opcion B, NV) | Pendiente contador |
| Lineas de la cuenta (`BillItem` o equivalente) | `Detalle[]` (`NmbItem`, `QtyItem`, `PrcItem`, `MontoItem`) | v1: una linea "Consumo restaurante" (doc 37); luego lineas reales, cuidando que la suma = MntTotal |
| `receiverRut`/`receiverName` | `Receptor` | Vacio => `66666666-6` (NV) |
| `Refund` -> `TaxDocument` NOTA_CREDITO | `TipoDTE 61` + `Referencia { TpoDocRef=39/41, FolioRef=boleta.folio, FchRef=boleta.issuedAt, CodRef=referenceCode, RazonRef=reason }` | `referenceCode` 3 parcial, 1 total (confirmar) |
| Respuesta `FOLIO` / token | `folio`, `providerDocId` | |
| Respuesta `PDF` (base64) | subir a storage -> `pdfUrl` | O consultar `/pdf` por folio |
| Respuesta `TIMBRE`, `XML` | `timbre`, y XML a storage | |
| Respuesta completa | `rawResponse` (sin base64 grandes) | |
| Estado `Aceptado`/`Pendiente`/`Rechazado` | `ISSUED`/`PENDING`/`REJECTED` | |

## 9. Diseno del adaptador

- `OpenFacturaTaxDocumentProvider implements TaxDocumentProviderPort` (`providerName = 'openfactura'`), registrado detras de `TAX_DOCUMENT_PROVIDER` junto con `NoopTaxDocumentProvider` y un flag por restaurante (si no hay credencial activa, no se emite y el documento queda sin proveedor).
- **Credenciales por restaurante:** reusar `SecretCipherService` (AES-256-GCM, AAD `provider:restaurantId`, clave `PAYMENTS_ENCRYPTION_KEY`) como `RestaurantPaymentAccount.accessTokenCipher`. Nueva tabla (seccion 10) con `apiKeyCipher`, `environment` (`dev`/`prod`), `status`. El adaptador resuelve credenciales con `restaurantId` del `TaxDocument` (el puerto hoy recibe `branchId`; ampliar el input con `restaurantId` y los datos del emisor, o cargarlos en el adaptador desde `taxDocumentId`).
- **Cliente HTTP:** `fetch` nativo con timeout, header `apikey` e `Idempotency-Key = taxDocumentId`; limitador local de 3 req/s por proceso; manejo de 429 con espera, y `400 OF-06` tratado como exito (leer token y consultar estado).
- **Maquina de estados:** `PENDING` -> `ISSUED` (respuesta con folio y estado Aceptado, o job que consulta `status` hasta Aceptado) | `REJECTED` (Rechazado, o error de validacion no reintentable; guardar `lastError`). `VOIDED` ya existe en el enum; no se usa para boletas (se corrige con NC). Errores de red/5xx/429: quedan `PENDING` con `attempts` y `nextRetryAt` (backoff exponencial, tope ~8 intentos), mismo `Idempotency-Key` mientras no pasen 24 h; despues consultar antes de reemitir.
- **Disparo:** al pagarse la cuenta (ultimo pago PAID) se crea `TaxDocument` PENDING dentro de la transaccion y un job fuera de ella lo emite (nunca llamar a Haulmer dentro de la transaccion de pago). Reembolso: conectar `CreatePendingCreditNoteService` al flujo de reembolso; el job emite la NC solo si la boleta de referencia esta `ISSUED`; si no, espera.
- **Nota de credito:** se emite desde `TaxDocument` NOTA_CREDITO usando `referenceDocument.folio`, `referenceCode`, `reason`; actualiza `Refund.creditNoteStatus`.
- **Reconciliacion:** job periodico que consulta emitidos `Pendiente` y `GET /organization/document` (folios restantes por tipo -> alerta al ADMIN).

## 10. Cambios de esquema necesarios (solo lista, requieren OK del dueno)

1. Nueva tabla `RestaurantTaxProviderAccount` (`restaurantId`, `provider`, `environment`, `apiKeyCipher`, `status`, `connectedAt`, `lastErrorMessage`, unique `restaurantId+provider`).
2. `Restaurant`: codigo de actividad (`Acteco`), comuna del emisor y, si falta, razon social legal.
3. `TaxDocument`: reemplazar `@@unique([branchId, type, folio])` por unique por `restaurantId` (folio pertenece al RUT).
4. `TaxDocument`: `attempts`, `nextRetryAt`, `lastError`, `providerStatus`, `xmlUrl` (o `xmlStorageKey`), `idempotencyKey` (si se quiere distinto del id).
5. Estado de pago/emision por cuenta opcional (`Bill.taxDocumentRequired`) si hay restaurantes sin facturador.
6. Detalle de lineas de la boleta (snapshot) si se emite con lineas reales.

## 11. Riesgos y preguntas abiertas

Riesgos:
- Costo por restaurante (30.000/mes) puede no ser absorbible.
- Docs oficiales no verificables desde aqui; el esquema real de boleta y de NC puede diferir de lo supuesto.
- Rate limit de 3 req/s y 100/min por key: si cada restaurante tiene su key, no se comparte; pero las llamadas de polling hay que acotarlas.
- Sandbox con empresas demo: no prueba aceptacion SII ni la certificacion del RUT del cliente; primeras pruebas reales ocurren en el piloto.
- Idempotencia de 24 h: reintentos tardios pueden duplicar si no se consulta antes.
- Almacenar la API key (cifrado ya resuelto) y rotarla si el restaurante la regenera.
- Contingencia: caida de Haulmer/SII; la venta nunca debe bloquearse por la boleta.

Preguntas abiertas:
1. Una credencial de integrador/partner puede emitir por varios RUT? Precio por volumen?
2. Existe sandbox con el RUT propio del restaurante o solo empresas demo?
3. Webhooks (aceptado/rechazado) o solo polling? Frecuencia recomendada.
4. Esquema exacto de boleta (39/41) y de NC 61 con `Referencia` en OpenFactura; tags de emisor para boleta; manejo de propina/`MontoNF`.
5. Envia OpenFactura el RVD/RCOF diario al SII?
6. Limites reales en produccion y SLA.
7. Como entrega y retiene XML/PDF (por cuanto tiempo) y si se puede pedir XML despues.
8. Codigo de referencia NC para reembolso parcial/total y plazo maximo (contador).
9. RUT generico para consumidor final y emision con RUT cuando el cliente lo pide.

## 12. Fuentes

- Precios: https://www.openfactura.cl/factura-electronica/precios/ (V)
- API (ejemplo curl oficial, header apikey e Idempotency-Key): https://www.openfactura.cl/factura-electronica/api/ (V)
- Intégrate a la API: https://www.openfactura.cl/articulos/integrate-a-la-api-de-openfactura/ (V)
- Como obtener la API key: https://help.haulmer.com/hc/apis/como-obtengo-la-api-key-de-openfactura-aa728802-2fe2-4f3d-9bb5-2113c357ba6a (V)
- Documentacion Postman (no legible por fetch): https://docsapi-openfactura.haulmer.com/
- Changelog: https://www.haulmer.com/articulos/changelog-openfactura/ (V)
- Analisis de terceros (endpoints, rate limit, idempotencia, sandbox): https://github.com/invoicerr-app/invoicerr/issues/909 (T)
- CLI no oficial: https://github.com/Lelemon-studio/openfactura-cli (T)
- Comparativa Folyo: https://folyo.cl/folyo-vs-haulmer (T)
- Formato boleta SII (campos): https://www.facturacion.cl/manualintegracion/archivoboletaintegracion.php
- Montos netos/brutos en boleta (LibreDTE): https://www.libredte.cl/docs/integracion/api/los-montos-se-envian-netos-o-brutos-al-emitir-por-api
- Doc previo: `docs/37-proveedor-boleta-electronica.md`
