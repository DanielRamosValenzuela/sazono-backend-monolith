# 37 - Proveedor de boleta electronica (investigacion y recomendacion)

Fecha de la investigacion: 2026-11-18. Alcance: elegir con que proveedor emitir boleta electronica (DTE 39 afecta, 41 exenta) y nota de credito (61) para Sazono, SaaS multi-restaurante. No hay codigo nuevo; este doc alimenta la decision del dueno y el contador (pregunta 7 de `docs/36-preparacion-tributaria.md`).

Convencion: "(verificado)" = lo lei en la pagina oficial citada; "(no verificado)" = viene de buscadores, repos de terceros, o no pude confirmarlo. Los precios cambian: reconfirmar con el proveedor antes de contratar. Las paginas del SII consultadas son antiguas (el instructivo de boleta es de 2021) y no pude leer el PDF (streams comprimidos).

## 1. Resumen ejecutivo

- Sazono necesita emitir para **muchos RUT** (cada restaurante es su propio contribuyente, con su certificado, sus CAF y sus autorizaciones SII). El factor decisivo no es la calidad de la API sino el **modelo multi-RUT y su costo por restaurante**.
- OpenFactura (Haulmer) tiene el mejor camino para empezar (API incluida, sandbox, sin cobro por documento, hace la certificacion/folios por ti) pero cobra **por empresa**: 360.000 CLP/ano + IVA por razon social (verificado), que para un restaurante chico es caro si lo absorbe Sazono. Su programa Partners es de reventa con deposito previo y no describe un modelo multi-emisor por API (verificado en la pagina de partners).
- Bsale Partners ofrece 1,5 UF/mes + IVA con 3.000 DTE y "RUT ilimitado" (verificado en bsale.partners) pero con permanencia minima de 12 meses y sin dato publico de sandbox ni de boleta por API para Chile (no verificado). Es el candidato mas cercano al modelo marketplace.
- SimpleAPI es multi-RUT con una sola API key y muy barato (5 a 12 UF/ano), pero es una libreria/servicio de bajo nivel: certificacion, CAF, certificados y reintentos quedan de nuestro lado (mas trabajo, mas control).
- **Recomendacion:** piloto con **OpenFactura** para 1 a 3 restaurantes reales (menor tiempo a produccion, riesgo bajo), mantener el puerto agnostico, y en paralelo pedir cotizacion partner a Haulmer y a Bsale; si el volumen de restaurantes pasa de ~10, evaluar SimpleAPI (o certificarse como emisor propio) para bajar el costo marginal por restaurante.

## 2. Requisitos del SII para boletas (contexto)

Fuentes: [guia SII certificacion boleta](https://www.sii.cl/factura_electronica/guia_emitir_boleta_servicio.htm), [instructivo tecnico boleta](https://www.sii.cl/factura_electronica/factura_mercado/Instructivo_Emision_Boleta_Elect.pdf), [manual certificacion](https://www.sii.cl/servicios_online/docs/manual_certificacion.pdf).

- **Quien certifica:** cada contribuyente que emite con software de mercado debe estar autorizado como emisor de DTE y certificar los tipos que usara. Los proveedores que hacen "certificacion por ti" (LibreDTE, OpenFactura) gestionan el tramite (LibreDTE verificado; OpenFactura no verificado en detalle).
- **Set de pruebas de boleta:** lo solicita el representante legal en el sitio del SII; revision de 10 a 15 dias habiles; luego se envian 5 correos a la casilla de certificacion de boletas y el SII da su V°B° (verificado en la guia SII). Se descarga un CAF de certificacion y se envian XML de boletas y el reporte de consumo de folios (secundario, no verificado en la guia; viene de busqueda).
- **Declaracion de cumplimiento:** tras el V°B° el representante legal completa la declaracion en el SII; la autorizacion rige desde el primer dia del mes en curso (verificado). El sitio de consulta de boletas debe aparecer impreso y estar activo (verificado).
- **Sin simulacion para boletas:** no se exige etapa de simulacion/intercambio/muestra impresa para boletas (no verificado, fuente secundaria).
- **RCOF:** el Reporte de Consumo de Folios fue reemplazado en la practica por el Resumen de Ventas Diarias (RVD) con el mismo esquema XML, y ya no hay que enviarlo al SII salvo en certificacion (no verificado; dos fuentes secundarias contradictorias en el detalle). **Pregunta abierta para el contador/proveedor:** si el proveedor lo envia automaticamente.
- **API del SII para boletas:** REST (OAS 3.0), con semilla/token, envio de boletas, consulta de estado de envio y de boleta individual, en `www4c.sii.cl/bolcoreinternetui/api/` (verificado como enlace en el instructivo; funciones segun busqueda). Las facturas siguen en SOAP.
- **Folios (CAF):** timbre por RUT y tipo de documento. Los folios son del contribuyente (RUT), no de la sucursal.

## 3. Comparacion

| Proveedor | API y docs | Boleta 39/41 y NC 61 | Multi-RUT | Precio | Sandbox |
|---|---|---|---|---|---|
| OpenFactura (Haulmer) | REST JSON; origenes `api.haulmer.com` y `dev-api.haulmer.com`, prefijo `/v2/dte` (segun analisis GitHub, no verificado). Docs oficiales: no pude abrir `docs.haulmer.com` (404). | Boleta electronica y exenta: verificado (pagina de precios). NC 61 con bloque `Referencia`: probada en sandbox en un repo de terceros (no verificado). | Cuentas sin limite de empresas, se cobra por empresa (verificado). No hay modelo marketplace por API publico. | Pyme 360.000 CLP/ano + IVA (ventas < 200 MM/mes); Grandes 1.200.000; razon social adicional 360.000; sin cobro por documento; API incluida; firma simple 11.790/ano (todo verificado). | Si, `dev-api.haulmer.com` con CAF simulado, timbre no valido ante SII (segun repos, no verificado). |
| LibreDTE | Servicio Plus con API web services (`/docs/integracion/api`) (verificado). Libreria PHP open source (LibreDTE Core). | Boleta afecta/exenta, NC y ND: verificado. | Varias empresas por cuenta si mismo representante legal; distinto representante exige otra cuenta (firma ligada a la cuenta) (verificado). Precio **por empresa**. | 40.000 CLP/mes + IVA hasta 2.000 docs; escalas hasta 760.000 (50.000 docs); formula `max(docs*15+10.000, 40.000)`; por empresa (verificado). Plan API antiguo desde 5.000 (2020, no confiable). | No verificado para Plus; la libreria soporta ambiente de certificacion SII. Ellos tramitan certificacion (verificado). |
| Bsale | REST `api.bsale.cl/v1/documents.json`; docs en `docs.bsale.dev` (verificado enlace). Mismo endpoint crea ventas y notas de credito (no verificado en detalle). | Boletas listadas (verificado); NC mediante tipo de documento y referencia (no verificado campos). | Partners: "RUT ilimitado" en el plan por DTE (verificado). Emision multiempresa por API no descrita (no verificado). | Partner: 1,5 UF + IVA/mes con 3.000 DTE, setup 0,6 UF, bolsa adicional 1,5 UF por 3.000 DTE, permanencia minima 12 meses (verificado). | No mencionado (no verificado). |
| SimpleAPI (Simple API) | REST; docs en `documentacion.simpleapi.cl`. Folios CAF por scraping del SII con limites de 1/s, 5/min, 100/h (segun busqueda, no verificado). | Boleta electronica (certificacion 2 UF) (verificado en pagina de precios); NC via set de factura (verificado). | "Multi RUT con la misma API key", cuota mensual global por plan (verificado). | Gratis 500 peticiones/mes por 12 meses; 5 UF (10.000), 9 UF (50.000), 12 UF (150.000) por ano + IVA; codigo fuente 70 UF; certificacion boleta 2 UF (verificado). | Si, sets de certificacion contra SII. Tu certificas cada RUT (no verificado el detalle). |
| Nubox | API de integraciones en `developers.nubox.com`; emision de boleta por POST con tipo 39/41 y folios manuales o automaticos (verificado). | Boletas 39/41, NC y ND (verificado). El endpoint es **exclusivo para partners** (verificado); NC referenciada no documentada en esa pagina. | No descrito; la cuenta es por empresa (no verificado). | No publico (no verificado). | No verificado. |
| Defontana / Obi | No encontre API publica de emision para terceros; Defontana es ERP certificado como facturador de mercado (busqueda). | Boleta electronica dentro del ERP (verificado en su ayuda); API no verificada. | No verificado. | No verificado. | No verificado. |
| DTE Cloud | No encontre resultados confiables del producto. | No verificado. | No verificado. | No verificado. | No verificado. |
| Facturapi | Es un producto orientado a Mexico (CFDI) segun mi conocimiento previo; no aparecio para el SII chileno. Descartado salvo evidencia contraria (no verificado). | No aplica | No aplica | No aplica | No aplica |
| SII directo (CAF y certificado propios) | API REST de boleta del SII (semilla/token, envio, estado). Firma XML, timbre PDF417, RVD y reintentos los construimos nosotros (libreria LibreDTE Core o `dte-sii` reducen el trabajo). | Todo posible, pero cada restaurante debe pasar su set de pruebas o Sazono actuar como software de mercado certificado. | Total: cada restaurante entrega certificado y CAF. | Sin costo por documento; costo = desarrollo y soporte. | Ambiente de certificacion SII (maullin/palena segun SII; no verificado). |

Webhooks: no encontre webhooks documentados en OpenFactura, LibreDTE Plus, Bsale ni Nubox (no verificado en ninguno). Asumir **sin webhooks**: la emision es sincrona (la respuesta trae folio y PDF) y el estado SII se consulta por polling. Esto debe confirmarse con cada proveedor.

## 4. Entrega de PDF, timbre y XML

- OpenFactura: la emision devuelve folio y PDF en base64 en el sandbox (no verificado, repo de terceros); no se confirmo TIMBRE ni XML en la respuesta.
- LibreDTE: genera XML firmado y PDF con timbre PDF417 (libreria; no verificado para Plus).
- Nubox y Bsale: PDF por endpoint aparte "Generar PDF" (Nubox, verificado como existencia).
- Regla SII: la boleta debe indicar la URL de consulta de boletas del SII; el timbre PDF417 va impreso. Para entregar al cliente, Sazono puede mostrar el PDF o la URL que devuelva el proveedor.

## 5. Nota de credito sobre boleta

- Una NC (61) referencia la boleta original en el bloque Referencia con tipo de documento referenciado (39/41), folio y codigo de referencia (1 anula, 2 corrige texto, 3 corrige montos). El proveedor la firma con folios de NC (CAF tipo 61) del mismo RUT. En OpenFactura se probo un bloque `Referencia` para NC (no verificado en docs oficiales). Nubox expone `documentoReferenciado` (tipo, folio, motivo, glosa) (verificado como campos).
- Hay que pedir el CAF de tipo 61 y certificar la NC ademas de las boletas (set del SII; en SimpleAPI el set de NC viaja con el de factura, verificado).
- Pregunta abierta: si una NC puede referenciar una boleta de otro dia o despues de cierto plazo (confirmar con contador).

## 6. Mapeo con nuestra interfaz

Puerto actual: `src/modules/billing/application/ports/tax-document-provider.port.ts`.

| Puerto / `TaxDocument` | Proveedor |
|---|---|
| `IssueBoletaInput` (netAmount, exemptAmount, vatAmount, tipAmount, totalAmount, taxDocumentId, branchId, billId) | Totales del DTE. La propina no es parte de neto/IVA (decision doc 36); decidir con el contador si va fuera de la boleta. Detalle: una linea agregada "Consumo restaurante" basta para boleta (no verificado que todos lo acepten). |
| `taxDocumentId` | Usar como clave de idempotencia / referencia externa. OpenFactura: idempotencia mencionada por un conector de terceros (no verificado); si el proveedor no la soporta, consultar por folio antes de reintentar. |
| `IssueCreditNoteInput.referenceFolio`, `referenceCode`, `reason` | Bloque Referencia de la NC (tipo ref, folio ref, codigo ref, razon). |
| `IssuedTaxDocument.folio` | `TaxDocument.folio` |
| `providerDocId` | `provider_doc_id` |
| `pdfUrl` | `pdf_url`; si el proveedor entrega base64, hay que subirlo a storage y guardar la URL. |
| `timbre` | `timbre` (si no viene, extraer del XML). |
| `siiTrackId` | `sii_track_id` (TrackID del envio al SII). |
| `raw` | `raw_response` |

Brechas que hay que cerrar antes de integrar (no son parte de esta tarea, solo se anotan):

1. El puerto recibe `branchId` pero el proveedor necesita las **credenciales y el RUT del emisor** (restaurante): hace falta un lugar para el RUT emisor (ya existe `Restaurant.taxId`) y las credenciales por restaurante cifradas (API key o certificado), por ejemplo una tabla de configuracion de proveedor por restaurante. Requiere schema nuevo: pendiente de autorizacion.
2. `@@unique([branchId, type, folio])` en `TaxDocument`: los folios (CAF) pertenecen al **RUT**, no a la sucursal; dos sucursales del mismo restaurante podrian recibir el mismo rango. La unicidad deberia ser por `restaurantId` (o por RUT emisor), tipo y folio.
3. No hay campo para el **XML**; con `raw_response` y `pdf_url` alcanza al inicio, pero el SII exige conservar el XML (confirmar con el contador).
4. Receptor: `receiverRut`/`receiverName` ya existen; la boleta a consumidor final usa RUT generico 66.666.666-6 (no verificado en esta investigacion).
5. Estado SII asincrono: `PENDING` -> `ISSUED`/`REJECTED` requiere un job que consulte estado por `siiTrackId` si el proveedor no lo resuelve en la respuesta.

## 7. Recomendacion y plan de salida

**Decision recomendada:** OpenFactura para el piloto, sin amarrar el codigo: implementar `OpenFacturaTaxDocumentProvider` detras de `TAX_DOCUMENT_PROVIDER` y mantener `NoopTaxDocumentProvider` como fallback por feature flag.

Por que: API incluida y sin cobro por documento, boleta y NC soportadas, sandbox, y Haulmer hace la certificacion. Contra: costo por razon social (360.000/ano + IVA), no hay modelo multi-emisor por API publicado, y la documentacion oficial no la pude leer en este analisis.

Pasos:

1. (Dueno) Decidir quien paga: Sazono absorbe el costo por restaurante, o se traspasa en el fee mensual. Con OpenFactura, el costo marginal por restaurante es ~30.000 CLP/mes + IVA: probablemente hay que traspasarlo.
2. (Dueno) Cotizar en paralelo: Haulmer Partners (modelo reventa y nivel Estandar/Premium con deposito) y Bsale Partners (1,5 UF/mes, RUT ilimitado) preguntando por emision multi-RUT por API, webhooks, sandbox y NC referenciada.
3. (Dueno, con el primer restaurante piloto) Contratar OpenFactura para ese RUT; el representante legal debe tener **clave SII** y **firma electronica** (certificado .p12/.pfx; OpenFactura vende firma simple por 11.790/ano), estar sin situaciones pendientes en el SII (actividad y direccion verificadas) y autorizar al proveedor.
4. (Dueno/restaurante) Solicitar set de pruebas de boleta (10 a 15 dias habiles), pedir CAF de certificacion, ejecutar set (el proveedor lo ejecuta si ofrece certificacion asistida), declaracion de cumplimiento, y luego CAF reales de 39/41 y 61.
5. (Dev) En sandbox: implementar el proveedor, guardar credenciales por restaurante, resolver brechas 1 a 3 de la seccion 6, conectar `CreatePendingCreditNoteService` al flujo de reembolso, job de estado y reintento idempotente.
6. (Dev + contador) Emitir 10 a 20 boletas y 2 NC reales de bajo monto en el RUT piloto y cuadrar con el Z diario y el RVD.
7. Despliegue por restaurante con flag; revisar el costo despues de 3 meses y decidir entre quedarse, partner (Haulmer/Bsale) o SimpleAPI / certificacion propia si hay mas de ~10 restaurantes.

## 8. Preguntas abiertas para el contador (se suman a las de doc 36)

1. Codigo de referencia de la NC por reembolso parcial (3) y total (1); plazo maximo para referenciar una boleta.
2. Boleta con propina: fuera de la boleta o incluida; la comision de plataforma de Sazono y su documento propio (Sazono tambien debe emitir facturas a los restaurantes por su fee).
3. Quien es el emisor frente al SII por cada restaurante (el restaurante, no Sazono) y que responsabilidad tiene Sazono como software de mercado.
4. Si el proveedor envia el RVD/RCOF diario o si Sazono debe hacerlo.
5. Conservacion del XML y plazo legal; si basta con el proveedor.
6. Folios por RUT multi-sucursal: una sola serie por restaurante o CAF separados por sucursal (el SII asigna por RUT, no por sucursal; no verificado).
7. Manejo de contingencia: que hacer si el proveedor o el SII estan caidos (emitir despues; plazos).
8. Tratamiento de restaurantes que ya tienen un facturador y folios vigentes (folios expirados deben anularse antes de migrar, segun LibreDTE).

## 9. Fuentes

- OpenFactura precios: https://www.openfactura.cl/factura-electronica/precios/
- Haulmer Partners: https://www.haulmer.com/partners/precios
- Analisis OpenFactura (terceros, sandbox/URLs): https://github.com/invoicerr-app/invoicerr/issues/909
- Prueba NC/Factura en sandbox OpenFactura (terceros): https://github.com/fernandasbr2026/serein-app/pull/159
- CLI no oficial OpenFactura: https://github.com/Lelemon-studio/openfactura-cli
- LibreDTE Plus: https://www.libredte.cl/plus
- LibreDTE precios y activacion: https://www.libredte.cl/faq/activacion-precios-y-terminos.pdf?full=1
- Bsale Partners: https://www.bsale.partners/
- Bsale documentos API: https://docs.bsale.dev/documentos/
- SimpleAPI precios: https://www.simpleapi.cl/Precios
- SimpleAPI FAQ: https://www.simpleapi.cl/FAQ
- SimpleAPI documentacion: https://documentacion.simpleapi.cl/
- Nubox emision de boleta: https://developers.nubox.com/emision-boleta-info
- Defontana, emitir boleta: https://intercom.help/defontanaerp/es/articles/4169449-emitir-boleta-electronica
- SII, certificacion de boleta: https://www.sii.cl/factura_electronica/guia_emitir_boleta_servicio.htm
- SII, instructivo tecnico boleta: https://www.sii.cl/factura_electronica/factura_mercado/Instructivo_Emision_Boleta_Elect.pdf
- SII, manual de certificacion: https://www.sii.cl/servicios_online/docs/manual_certificacion.pdf
- Devlas dte-sii (alternativa de libreria): https://github.com/devlas-cl/dte-sii
