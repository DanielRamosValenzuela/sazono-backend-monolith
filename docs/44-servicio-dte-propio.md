# 44. Servicio DTE propio (microservicio) vs proveedor

Fecha: 2026-11-19. Estado: evaluacion para decision del dueno. No es legal ni tributario; los temas legales los ve el dueno.

Convencion: **(V)** = leido en pagina oficial o fuente primaria durante la investigacion. **(T)** = fuente de terceros. **UNVERIFIED** = no se pudo confirmar. **(supuesto)** = supuesto propio, no dato. Los montos de esfuerzo son juicio de ingenieria, no datos. Los montos en CLP son netos de IVA.

Limitaciones: el doc 36 (`36-preparacion-tributaria.md`) no esta en `docs/` del monolito (esta en `../docs/` del repo raiz segun doc 37) y no fue leido en esta evaluacion. La documentacion oficial de la API REST de boleta del SII (`www4c.sii.cl/bolcoreinternetui/api/`) respondio 503, asi que endpoints y errores vigentes no estan verificados.

## 1. Respuesta directa al dueno

**Se puede construir, pero no a tiempo ni con sentido economico para febrero 2027 con 2-3 clientes.** El cuello de botella no es el codigo sino el SII: cada RUT debe certificarse y, para ser "sistema autorizado" (que cada cliente solo pida habilitacion), el SII exige haber habilitado al menos 10 contribuyentes y tener 6 meses de experiencia emitiendo boletas (V, Res. Ex. SII 74/2020, seccion J; https://www.sii.cl/servicios_online/3785-.html). Hasta eso, cada cliente de Sazono pasa su propia certificacion.

### 1.1 Esfuerzo y calendario (construir)

MVP = boleta 39/41 + nota de credito 61, multi-tenant, boveda de certificados/CAF, cliente SII, integracion con Sazono, QA en certificacion. Desglose de 17 items en la investigacion de esfuerzo.

| | Bajo | Probable | Alto |
|---|---|---|---|
| Dias-persona | 65 | 104 | 168 |
| Semanas-persona (5 dias) | 13 | 21 | 34 |
| Calendario, 1 dev senior con IA, 100% dedicado | 3,1 meses | 5,0 meses | 8,0 meses |
| Calendario, 2 devs (paralelizacion ~1,5x, juicio propio) | ~43 dias | ~70 dias | ~112 dias |
| Fase posterior: factura 33/34, NC/ND, simulacion, intercambio, muestras (dias-persona) | 32 | 52 | 84 |
| Fase posterior: guia 52 incluida arriba | incl. | incl. | incl. |

Notas:
- Los items de mayor varianza son el cliente SII REST y la automatizacion del set de certificacion (fuentes se contradicen sobre REST vs SOAP en certificacion, ver seccion 7).
- Portar logica de `devlas-cl/dte-sii` (MIT) podria ahorrar 25-35% en los items 2 a 9 (UNVERIFIED). Esa libreria fue archivada el 2026-11-04 y quedo sin soporte; su sucesor "SII SDK" no tiene licencia ni madurez verificadas.
- Dias habiles disponibles del 2026-11-19 al 2027-01-31: ~47 (aprox., descontando 8-dic, 25-dic, 1-ene). Con 2 devs el escenario probable (~70 dias efectivos de MVP completo) **no cabe**; un MVP recortado (un restaurante, sin panel, sin RVD, PDF simple) estima 50 / 75 / 110 dias y sigue sin dar margen para el SII. Probabilidad de tener al cafe emitiendo boletas reales con servicio propio a fin de enero: baja (juicio propio).

### 1.2 Costo de infraestructura mensual (propio)

| Rubro | USD/mes | Fuente |
|---|---|---|
| BD (Supabase Pro) | 25 | V https://supabase.com/pricing.md |
| Computo API + workers (1 contenedor) | 5 a 20 | UNVERIFIED |
| KMS (1-2 claves) | 2 a 5 | V https://aws.amazon.com/kms/pricing/ |
| Almacen de objetos XML (+ copia en otro proveedor) | 1 a 5 | V parcial / T |
| Monitoreo, dominio, correo | 2 a 15 | UNVERIFIED |
| **Total sin PITR** | **~35 a 70 (~33.000 a 66.000 CLP/mes, a 950 CLP/USD, UNVERIFIED)** | suma |
| PITR de Supabase (opcional) | +100 | V |

Para los calculos de la tabla 1.4 se usa 2 M CLP/ano de infra + backups (supuesto conservador de la investigacion de mercado, mayor que 66.000 x 12).

### 1.3 Plazos y costos legales/administrativos

| Item | Plazo / costo | Estado |
|---|---|---|
| Set de pruebas de boleta por RUT: revision del SII | 10 a 15 dias habiles (V, https://www.sii.cl/factura_electronica/guia_emitir_boleta_servicio.htm) | V |
| Resto de la certificacion boleta (5 envios, V°B°, declaracion de cumplimiento) | sin plazo oficial; estimacion propia 3 a 6 semanas por RUT si el software esta listo y el set sale a la primera | UNVERIFIED |
| Certificacion factura (simulacion, intercambio, muestras impresas) | sin plazos oficiales; el manual es de 2009 | UNVERIFIED |
| Certificado digital del representante legal | 7.990 a 15.990 + IVA segun entidad (T, https://granloop.com/blog/certificado-digital-sii, 2026-10-14); firma electronica en OpenFactura 11.790 por 1 ano | T |
| Ser "sistema autorizado" ante el SII | 10 RUT habilitados + 6 meses de experiencia (V). Como los primeros clientes son 2-3, no antes de 2028 en un caso razonable; el significado exacto de "desde 01.07.2020 mediante certificacion automatica" no esta claro (UNVERIFIED, consultar al SII) | V / UNVERIFIED |
| Abogado: licencias (AGPL), contrato de servicio, mandato, Ley 21.719 de datos personales (vigencia 1-dic-2026 por ley; hay proyecto de postergacion, fuentes discrepan, T https://araya.cl/ley-de-proteccion-de-datos-se-postergara-su-entrada-en-vigencia/) | Costo no estimado; lo gestiona el dueno | UNVERIFIED |
| Seguro de responsabilidad civil | no cotizado | UNVERIFIED |

Tiempo de trabajo por cada RUT nuevo: ~6 horas (supuesto), ~25.000 CLP.

### 1.4 Construir vs comprar, CLP por ano

Supuestos (propios): UF = 40.900 CLP (reconfirmar con valor del dia); cafe = ~50 boletas/dia = ~1.500 DTE/mes por RUT; dev cargado 4 M CLP/mes; mantencion 0,25 persona/ano = 12 M/ano; infra 2 M/ano; sin descuentos por volumen (negociables, UNVERIFIED); sin soporte al cliente ni costos legales.

Comprar (precios oficiales, V):
- OpenFactura: 360.000 + IVA por razon social al ano, documentos ilimitados, certificacion y habilitacion incluidas; pago inicial 371.790 + IVA con firma (https://www.openfactura.cl/factura-electronica/precios/).
- Bsale Partners: 1,5 UF + IVA/mes por 3.000 DTE y RUT ilimitados, habilitacion 0,6 UF, permanencia 12 meses (https://bsale.partners). Bloques extra a 1,5 UF: pago mensual de bloques extra UNVERIFIED.
- SimpleAPI (https://www.simpleapi.cl/precios): 5 a 12 UF/ano + folios 3 a 9 UF, pero es servicio de bajo nivel; certificacion SII, CAF y reintentos quedan de nuestro lado; no queda claro si cubre boletas 39/41 (UNVERIFIED). No se incluye en la comparacion como alternativa equivalente.

Construir (costo MVP): bajo 12 M / probable 20 M / alto 32 M (dias de arriba x 4 M/mes). Ano 1 = MVP + 12 M + 2 M = 26 / 34 / 46 M. Anos siguientes ~14 M/ano (mas factura 33/34 si se agrega: +6 / +10 / +16 M una vez, supuesto).

| Restaurantes | OpenFactura (ano) | Bsale Partners (ano, ~n/2 bloques) | Propio, ano 1 (bajo / probable / alto) | Propio, anos siguientes |
|---|---|---|---|---|
| 2 | 0,72 M | ~0,74 M | 26 / 34 / 46 M | ~14 M |
| 3 | 1,08 M | ~1,47 M | 26 / 34 / 46 M | ~14 M |
| 10 | 3,6 M | ~3,7 M | 26 / 34 / 46 M | ~14 M |
| 30 | 10,8 M | ~11,0 M | 26 / 34 / 46 M | ~14 M |
| 100 | 36 M | ~36,8 M | 26 / 34 / 46 M | ~14 M |

Lectura:
- Con 2-3 clientes construir cuesta del orden de 24 a 64 veces mas en el ano 1. Con 10, 7 a 13 veces. Con 30, 2,4 a 4,3 veces. Con 100, 0,7 a 1,3 veces (empata).
- Punto de equilibrio contra OpenFactura (~360.000 por RUT): ~39 RUT solo contra el costo operativo (14 M); ~57 RUT si el desarrollo probable (20 M) se amortiza en 3 anos; ~94 RUT contra el costo completo del ano 1 (34 M).
- Las tarifas de mercado de terceros comparables (T, no verificadas en pagina oficial): LibreDTE Plus desde 40.000 CLP/mes por empresa (V, https://www.libredte.cl/plus), es decir mas caro que OpenFactura; Nubox, Facturacion.cl, Toteat (POS con boleta integrada) en conflicto o sin dato verificado.
- Vender el servicio como competidor: hipotetico 100 clientes x 25.000 CLP/mes = 30 M/ano contra 14-20 M de costo base mas soporte comercial; margen angosto y requiere esfuerzo comercial que hoy no existe (inferencia propia). El SII lista 83 proveedores autorizados de boleta (V, https://www.sii.cl/servicios_online/3785-proveedores_autorizados_be.html), incluido Toteat, POS de restaurantes. El mercado esta saturado; la barrera es certificacion, confiabilidad y soporte, no precio.
- El numero de proveedores de mercado inscritos para factura y lo que hacen otros POS (Toteat, Rofex, Fudo) construir o comprar: UNVERIFIED.

## 2. Recomendacion para la apertura de febrero 2027

**Hibrido, con comprar como camino de salida a produccion.**

1. **Febrero 2027: emitir con OpenFactura** detras de `TaxDocumentProviderPort` (diseno ya en doc 43). Costo ano 1: 371.790 + IVA, incluye certificacion y habilitacion del RUT (V). Un proveedor autorizado hace que el cafe solo pida su habilitacion en lugar de pasar el set (V, Res. 74 seccion J). Ver tambien doc 37.
2. **El servicio propio se construye como otro adaptador del mismo puerto**, no como camino critico. Se arranca cuando el dueno confirme que quiere el producto (venta a terceros o ahorro a escala) y despues de que el cafe este estable.
3. **Checkpoint firme: 2026-12-15 (martes).** Se evalua si el servicio propio es candidato a estar en produccion en el cafe. Se considera GO solo si se cumplen **todos**: (a) el dueno ya tiene el set de pruebas del SII entregado para el RUT del cafe, (b) el firmado XML y el TED ya pasaron validacion en el ambiente de certificacion del SII (la REST o SOAP funciona con un RUT real), (c) hay 2 devs disponibles al 100%. Si falla alguno, **NO-GO: el cafe sale con OpenFactura y el servicio propio pasa a v2 sin fecha comprometida**. Lo esperable es NO-GO.
4. **Ultimo punto de no retorno: 2027-01-15.** Si aun con GO en diciembre la certificacion propia no tiene V°B° del SII, el cafe se activa con OpenFactura (la activacion del proveedor toma solo dias; el costo hundido es acotado, ~372.000 + IVA).
5. **No usar codigo AGPL** (LibreDTE core, modulos Odoo) como base si se quiere vender el servicio (V, https://core.libredte.cl/docs/lib/licencia; la clausula de red AGPL es conocimiento general, validar con abogado). Usar `devlas-cl/dte-sii` (MIT) y `typedte-sii` (Apache-2.0) solo como referencia y casos de prueba, no como dependencia critica.
6. **Reevaluar construir** al pasar de ~40 restaurantes, o si el dueno quiere vender el servicio y acepta no ser rentable hasta ~100 clientes.
7. Mantener `NoopTaxDocumentProvider` como respaldo: la venta nunca se bloquea por la boleta (doc 43 seccion 11).

## 3. Plan de hitos 2026-11-20 a 2027-01-31

El camino critico es el SII. Los hitos del dueno estan marcados **[DUENO]**.

| Fecha | Hito | Responsable |
|---|---|---|
| 2026-11-20 (vie) | Confirmar con el contador: giro y actividad inscritos del cafe, Primera Categoria, inicio de actividades dado (V, Res. 74 seccion B), propina, plazo/codigo de NC, conservacion del XML | **[DUENO]** |
| 2026-11-20 a 11-27 | Obtener certificado digital del representante legal del cafe (si no lo tiene); confirmar Clave SII y usuario administrador | **[DUENO]** |
| 2026-11-27 (vie) | Decision: contratar OpenFactura para el cafe (pago ~371.790 + IVA con firma). Preguntar cuando se activa la habilitacion y si hay descuento por volumen | **[DUENO]** |
| 2026-11-27 | Si se quiere el camino propio en paralelo: **[DUENO]** solicita el Set de Prueba de boleta al SII para el RUT del cafe (10 a 15 dias habiles de revision: llega entre ~2026-12-11 y 2026-12-18). Sirve para cualquiera de los dos caminos | **[DUENO]** |
| 2026-11-27 a 12-11 | Dev: adaptador OpenFactura detras del puerto (8-12 dias-persona, juicio propio) + cambios de esquema (seccion 5). En paralelo, spike del servicio propio: firma XMLDSig + TED + cliente semilla/token contra apicert (probar REST vs SOAP en certificacion) | Dev |
| 2026-12-11 | Sandbox de OpenFactura funcionando de punta a punta (boleta + NC) con `TaxDocument` PENDING | Dev |
| 2026-12-15 (mar) | **CHECKPOINT GO/NO-GO del servicio propio para la apertura** (criterios en seccion 2). Se registra por escrito | Dueno + dev |
| 2026-12-15 a 12-31 | Camino proveedor: OpenFactura gestiona certificacion/habilitacion del RUT del cafe; el dueno firma lo que pida el SII como representante legal (declaracion de cumplimiento) | **[DUENO]** |
| 2026-12-18 | Revision de avance: set de prueba recibido? V°B° del SII (si camino propio)? | Dueno + dev |
| 2027-01-04 | Sitio web de consulta de boletas de verificacion, que debe estar activo y la leyenda impresa/virtual en la boleta (V, guia SII) | Dev |
| 2027-01-08 | Solicitud de CAF para boletas 39/41 y NC 61 por RUT (solo un firmante autorizado puede pedirlos, V instructivo_emision.pdf seccion 1.3); no pedir el CAF de certificacion antes de tener el flujo listo (vencería a las 24 h segun Odoo, UNVERIFIED) | **[DUENO]** |
| 2027-01-15 (vie) | **Punto de no retorno**: si el camino propio no tiene V°B° del SII, el cafe sale con OpenFactura | Dueno |
| 2027-01-18 a 01-29 | Pruebas de extremo a extremo en el local: boleta, reembolso con NC, caida del servicio (venta no se bloquea), folios y alertas | Dev + dueno |
| 2027-01-29 (vie) | Cafe habilitado para emitir boletas en produccion; revision final del checklist | Dueno + dev |
| 2027-01-31 | Margen de seguridad antes de la apertura de febrero | |

Pendientes que el dueno debe consultar al SII antes de 2026-12-15: ver seccion 6.

## 4. Arquitectura resumida (si se construye)

Servicio separado (`dte-service`, NestJS/TypeScript, Postgres propio).

- **API HTTP** (sincrona): valida, asigna folio, persiste, responde 202. Auth por API key por tenant (hash), mTLS o HMAC entre servicios. Todo bajo `/v1`.
- **Worker de emision**: arma XML, firma XMLDSig, genera TED con el CAF, envia al SII, consulta estado. La cola es la tabla de documentos (outbox con `FOR UPDATE SKIP LOCKED`); no hace falta Kafka ni SQS a este volumen. Estados: `RECEIVED -> FOLIO_ASSIGNED -> SIGNED -> SENT -> ISSUED | REJECTED`, mas `RETRY_WAIT` y `NEEDS_ACTION`. Backoff exponencial con jitter, tope ~8 reintentos (decision propia).
- **Boveda**: cifrado de sobre. KEK en KMS (AWS KMS ~US$2 a 5/mes, V). DEK AES-256-GCM por secreto (.pfx, CAF y su clave privada), AAD = `rutEmisor:tipoSecreto:id`. Se descifra solo en memoria del worker. Alternativas: Supabase Vault (mas simple, una sola clave raiz por proyecto, debil para custodiar certificados de terceros que se revenden, V); `SecretCipherService` del monolito con clave en variable de entorno ($0, solo paso inicial).
- **Folios**: tabla `caf` + `folio_asignado` con unique `(rut, tipo, folio)`. Asignacion con `SELECT ... FOR UPDATE` en la misma transaccion que crea el documento (no `SEQUENCE`, que deja huecos). Un folio usado una vez no se reutiliza; los no usados deben anularse (V, Res. 74 F.1 y F.2). Alertas: folios bajos (max(10% del rango, ventas de 3 dias), regla propia) y CAF/certificado por vencer a 30 y 7 dias. La reposicion de CAF en sii.cl es manual del firmante (UNVERIFIED que exista API).
- **Idempotencia**: unica por `(tenant, Idempotency-Key = TaxDocument.id)` para siempre (OpenFactura la limita a 24 h, T doc 43). Mismo body = misma respuesta; distinto body = 422. Un reintento nunca consume otro folio.
- **Contrato**: `POST /v1/documents` (39/41/61), `GET /v1/documents/{id}`, `/xml`, `/pdf`, `/timbre`, `PUT /v1/tenants/{rut}/certificate` y `/caf`, `GET /v1/tenants/{rut}/folios`, webhook firmado con HMAC. El monolito pasa los montos ya calculados (`computeVatBreakdown`); el servicio solo valida neto + IVA = total.
- **Almacen**: XML tal como se envio, con retencion minima de 6 anos desde el vencimiento del periodo tributario (V, Res. 74 F.10; art. 17 y 200 Codigo Tributario), en objeto versionado con hash SHA-256 y copia en otro proveedor; no depender del backup de la BD. Que un tercero custodie el XML: UNVERIFIED que el SII lo acepte sin mas; se cubre por contrato con acceso garantizado al contribuyente.
- **Contingencia**: la cola sigue firmando y asignando folios con el SII caido y envia en bloque al volver. Plazo de envio de 1 hora (V, Res. 74 F.6, redactado para falta de cobertura de datos; aplicarlo a caida del SII es interpretacion propia, UNVERIFIED). Alerta a 45 minutos de pendientes. No hay procedimiento oficial verificado.
- **Reportes diarios**: RVD/RCOF ya **no se envia** en produccion desde 2022-08-01 (V, Res. Ex. SII 53/2022, https://www.sii.cl/noticias/2022/040822noti01rp.htm). Una libreria de terceros dice que RCOF solo se exige en certificacion (T, UNVERIFIED). El item 8 del esfuerzo (2/4/6 dias) puede bajar a solo certificacion.
- **Observabilidad/entornos**: logs con `request_id`, `tenant`, `docId`; metricas de cola, edad del mas antiguo, rechazos, folios; `certificacion` y `produccion` totalmente separados (BD, KEK, API keys, bucket, CAF distintos).
- **Multi-tenant para reventa**: `tenant`, `emisor` (RUT), `api_key`, RLS en Postgres como segunda barrera, KEK por tenant para clientes externos, `usage_event` para medir.
- **Certificado**: el .pfx identifica a una persona natural y es intransferible (V, Res. 74 def. 4); su uso por un tercero exige mandato escrito (consultar al abogado el mandato electronico F3500, T, UNVERIFIED). Nunca pedir ni guardar la Clave SII del cliente (consejo propio).

Detalles tecnicos relevantes del formato (V salvo marcado):
- Boleta: REST con token de boleta (el de factura no sirve), TLS >= 1.2, maximo 500 boletas por envio, track id de 15 digitos (instructivo del 28/10/2021, https://www.sii.cl/factura_electronica/factura_mercado/Instructivo_Emision_Boleta_Elect.pdf). Consumidor final: RUT 66.666.666-6. Factura sigue con SOAP.
- Firma: XMLDSig; RSA-SHA1/C14N segun terceros (UNVERIFIED), y las fuentes discrepan entre C14N inclusiva y exclusiva; resolver contra el set de pruebas. TED: `<DD>` extraido con regex, Latin-1, SHA1withRSA con la clave del CAF (V, https://cryptosys.net/pki/xmldsig-ChileSII.html).
- Timbre PDF417 impreso opcional desde 2026-01-01 (Res. 207, T, no se leyo el texto oficial); sigue siendo obligatorio dentro del XML. Boleta impresa o virtual (Res. 53/2025, V, https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_8793.htm).
- Gotchas de terceros (UNVERIFIED): zona America/Santiago obligatoria, no quitar `xmlns` de `<DTE>`, ASCII en TED, datos de produccion en certificacion causan rechazo.
- Ley 21.713: boletas sobre 135 UF con medio de pago (T/UNVERIFIED, el contador lo ve; consumos de cafe no deberian llegar a ese monto).

## 5. Que reusar del codigo y cambios de esquema

El modelo `TaxDocument` y el puerto `TaxDocumentProvider` (descritos en docs 37 y 43) no se tocan en su esencia: el servicio propio es un adaptador mas. Nota: no se reviso `schema.prisma` en esta sesion; confirmar nombres contra el codigo antes de implementar.

Reusar:
- `TaxDocument` PENDING creado dentro de la transaccion de pago; el llamado al proveedor ocurre fuera de ella (doc 43). Su `id` es la clave de idempotencia.
- `TaxDocumentProviderPort` y `NoopTaxDocumentProvider` como respaldo.
- `computeVatBreakdown` para montos.
- `SecretCipherService` (AES-256-GCM, AAD `provider:restaurantId`, `PAYMENTS_ENCRYPTION_KEY`) como patron; para el servicio propio sube a KMS.

Cambios de esquema (ya definidos en doc 43 seccion 10, necesarios para cualquiera de los dos caminos):
1. Tabla `RestaurantTaxProviderAccount` (`restaurantId`, `provider`, `environment`, `apiKeyCipher`, `status`, `connectedAt`, `lastErrorMessage`, unique `restaurantId+provider`).
2. `TaxDocument`: reemplazar `@@unique([branchId, type, folio])` por unique por `restaurantId` (el folio pertenece al RUT, no a la sucursal).
3. El puerto hoy recibe `branchId`; ampliar el input con `restaurantId` y datos del emisor (o cargarlos en el adaptador desde `taxDocumentId`).

Adicionales solo para el servicio propio (propuestos):
- Valor de `provider` para el servicio propio (p. ej. `SAZONO_DTE`) y `environment` `certificacion`/`produccion`.
- Campos de seguimiento del documento externo (`externalId`, `siiTrackId` de 15 digitos) si no existen; el servicio entrega `status, folio, siiTrackId, lastError, attempts`.
- Pantallas del monolito para subir certificado y CAF y ver estado (item 15 del esfuerzo: 6/9/14 dias).
- Webhook entrante del servicio con HMAC y reconciliacion por polling como respaldo.
- Si se migra de OpenFactura al propio: LibreDTE advierte anular folios vigentes antes de migrar (doc 37); si hay que recertificar el RUT, UNVERIFIED.

## 6. Riesgos y preguntas abiertas

Riesgos:
1. **SII como camino critico**: set de prueba (10-15 dias habiles) y V°B° dependen de terceros y de la agenda del dueno; no hay plazo oficial para el V°B°.
2. **Documentacion oficial desactualizada o inaccesible**: instructivo de boleta de 2021; API REST oficial dio 503; manual de certificacion de factura de 2009.
3. **Contradicciones entre fuentes sin resolver** (probar con RUT real): REST vs SOAP en certificacion (una libreria dice que REST no funciona en certificacion); si el set actual exige RCOF; C14N inclusiva vs exclusiva; hosts `apicert/api` vs `pangal/rahue`; y si la certificacion de boleta aun exige ser emisor de DTE o estar certificandose en paralelo (la guia SII lo menciona segun una fuente; la Res. 74 elimino la exigencia de ser antes emisor de factura electronica, V).
4. **Dependencias de codigo**: `dte-sii` archivado (sin parches); `typedte-sii` no certificado ni probado contra el SII; LibreDTE AGPL sin licencia comercial de la libreria PHP (V).
5. **Custodia de certificados y CAF** de terceros: el peor caso es el robo del .pfx (permite firmar tramites a nombre de una persona natural). Mitigacion en seccion 4; riesgo residual alto para un equipo pequeno.
6. **Responsabilidad**: multas por incumplimientos recaen en el contribuyente (V, Res. 74 L), pero el cliente reclamara al proveedor; evaluar seguro y tope contractual (UNVERIFIED que tope es valido en Chile).
7. **Operacion**: guardia ante rechazos del SII, reposicion de CAF por firmante, vencimiento de certificados.
8. **Costo de oportunidad**: 2 devs en DTE propio dejan de trabajar en producto antes de la apertura.
9. **Tipo de cambio, UF y supuestos** (dev 4 M CLP/mes, mantencion 0,25 persona) son propios; el resultado depende mucho de ellos.

Preguntas abiertas (al SII, al contador o al abogado):
1. Endpoints, hosts, limites de tasa y errores vigentes de la API REST de boleta en certificacion y produccion.
2. Flujo de la "certificacion automatica" y que cuenta como "10 contribuyentes habilitados desde 01.07.2020" (¿cuentan los habilitados por un proveedor ajeno?).
3. Texto oficial de la Res. 207/2025 (timbre impreso opcional) y vigencia exacta de la Res. 53/2025.
4. Procedimiento oficial de contingencia con el SII caido, para boleta y factura.
5. Plazo y reglas de emision de la NC (y del anulado de folios no enviados).
6. Si el SII limita postulaciones simultaneas desde un mismo proveedor o IP; si se puede certificar varios RUT en paralelo.
7. Si un tercero puede ser firmante delegado o actuar por mandato con el .pfx del cliente.
8. Si la custodia del XML por un tercero es aceptada por el SII.
9. Ley 21.719: fecha real de entrada en vigencia, multas y obligaciones del encargado de tratamiento (las fuentes discrepan; T).
10. Descuentos por volumen de Haulmer/OpenFactura y Bsale; si SimpleAPI cubre boletas 39/41; cotizar Facto, Obbi, DTE Cloud (sin datos verificados).
11. ¿Se quiere realmente vender el servicio a terceros? Cambia la decision de AGPL, KEK por tenant, SLA y contrato.

## 7. Fuentes

SII (V salvo indicacion):
- https://www.sii.cl/factura_electronica/guia_emitir_boleta_servicio.htm
- https://www.sii.cl/factura_electronica/factura_mercado/Instructivo_Emision_Boleta_Elect.pdf
- https://www.sii.cl/normativa_legislacion/resoluciones/2020/reso74.pdf
- https://www.sii.cl/noticias/2022/040822noti01rp.htm
- https://www.sii.cl/normativa_legislacion/resoluciones/2025/res_ind2025.htm (solo listado)
- https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_8793.htm
- https://www.sii.cl/servicios_online/3785-.html
- https://www.sii.cl/servicios_online/3785-proveedores_autorizados_be.html
- https://www.sii.cl/factura_electronica/factura_mercado/elegir_sistema_fe.htm
- https://www.sii.cl/factura_electronica/factura_mercado/menu_certificacion.html
- https://www.sii.cl/factura_electronica/factura_mercado/instructivo.htm
- https://www.sii.cl/factura_electronica/instructivo_emision.pdf
- https://www.sii.cl/servicios_online/docs/manual_certificacion.pdf (2009)
- https://www.sii.cl/factura_electronica/modelo_operacion.pdf
- https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_1119.htm
- https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_1455.htm
- https://www.sii.cl/servicios_online/1039-proc_postulacion-1184.html
- https://www.chileatiende.gob.cl/fichas/3007-inscripcion-de-un-sistema-de-facturacion-electronica
- https://www4c.sii.cl/bolcoreinternetui/api/ (503 al consultar, UNVERIFIED)
- https://www.sii.cl/servicios_online/docs/guias_ayuda/guia_centralizar_certificado_digital.pdf (T)

Precios y mercado:
- https://www.openfactura.cl/factura-electronica/precios/ (V)
- https://bsale.partners (V)
- https://www.simpleapi.cl/precios (V)
- https://www.libredte.cl/plus (V)
- https://www.bsale.cl/sheet/nuevos-precios (T, resumen de buscador)
- https://toteat.com/productos/boletas-electronicas (sin precio)
- https://aws.amazon.com/kms/pricing/ (V)
- https://supabase.com/pricing.md (V), https://supabase.com/docs/guides/database/vault (V)
- https://granloop.com/blog/certificado-digital-sii (T)
- https://webiados.com/blog/sistema-pos-chile-2026-comparativa, https://www.nextsoft.cl/mejores-software-restaurantes-chile.html, https://klevo.cl/blog/facturacion-electronica-sii-integracion-sitio-web-chile/, https://hexcala.cl/blog/mejores-erp-facturacion-electronica-chile/, https://blog.nubox.com/software/sistema-de-facturacion (T)
- https://infisical.com/blog/secrets-manager-pricing, https://www.backblaze.com/cloud-storage/comparison/backblaze-vs-s3 (T)
- https://araya.cl/ley-de-proteccion-de-datos-se-postergara-su-entrada-en-vigencia/ (T)

Codigo abierto y tecnico:
- https://github.com/LibreDTE/libredte-lib-core, https://core.libredte.cl/docs/lib/licencia (AGPL, V)
- https://github.com/devlas-cl/dte-sii (MIT, archivado 2026-11-04)
- https://github.com/luisnavarrete12/TypeDte (Apache-2.0, no certificado)
- https://github.com/TuringForgeSpA/tf_dte_cl_boleta, https://github.com/dansanti/l10n_cl_dte (Odoo, AGPL)
- https://cryptosys.net/pki/xmldsig-ChileSII.html (V), https://www.blackend.dev/blog/integracion-boleta-electronica-sii-guia-tecnica (T)
- https://www.example-code.com/java/apicert_sii_cl_boleta_electronica_token.asp (T)
- https://www.diarioconstitucional.cl/2026/01/04/sii-elimina-obligacion-de-incorporar-la-impresion-del-timbre-electronico-en-la-representacion-impresa-de-la-boleta-electronica-de-ventas-y-servicios/ , https://www.gbusinessit.cl/blog/resolucion-sii-207-2026/ (T)

Internos: `docs/37-proveedor-boleta-electronica.md`, `docs/43-openfactura-integracion.md`. El doc 36 no fue leido.
