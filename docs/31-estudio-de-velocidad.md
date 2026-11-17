# 31. Estudio de velocidad del backend

Estudio medido (no estimado) de la latencia de todas las rutas del backend, diagnóstico con evidencia, mejoras rápidas ya aplicadas y plan priorizado. Fecha de las mediciones: 2026-11-17. Medido desde la máquina del desarrollador en Chile, contra la base QA de Supabase (`aws-1-us-west-2`, Oregón) y contra el despliegue en Render (Oregón).

## Resumen ejecutivo

1. **La lentitud que se ve en local (2 s por request) es distancia a la base de datos, no código lento.** Desde Chile cada ida y vuelta (RTT) al pooler de Supabase en Oregón cuesta **215 ms**. Un endpoint que hace 10 consultas secuenciales cuesta ~2,2 s. La regla que cuadra con todas las mediciones: `latencia local ≈ 215 ms × viajes secuenciales a la base`.
2. **En producción (Render en Oregón, misma región que la base) esa componente casi desaparece.** Medido contra `sazono-backend-monolith.onrender.com` desde Chile: p50 mínimo 203 ms, mediana **221 ms**, máximo 374 ms (login) entre 41 rutas. Los ~205 ms base son el RTT Chile a Oregón; la base y el cómputo suman 10 a 110 ms según el endpoint. **El piso de latencia de producción es la distancia Chile a Oregón.**
3. Por eso **Redis no acelera nada hoy** (la base ya está a 2 a 5 ms de Render) y **las réplicas de lectura tampoco**. Lo que sí baja el piso: acercar backend y base a Chile. Santiago a São Paulo (`sa-east-1`) mide ~60 a 70 ms contra ~227 ms a Oregón (ver sección 2), o sea **-140 ms por request (-60 a -65 %)**.
4. Lo que probablemente más duele hoy al usuario real, en orden: (a) el *spin-down* del plan gratis de Render (~1 min de espera tras 15 min sin tráfico), (b) pantallas que encadenan varios requests de ~205 ms cada uno, más el salto por la función de Vercel en Washington (`iad1`, región por defecto), (c) un balde de rate limit de 100 req/min que casi seguro es **compartido por todos los clientes** (sección 4.8), (d) el polling de cocina, salón y QR sobre una CPU gratuita.
5. Se aplicaron mejoras rápidas y seguras en `src/common` y `src/modules/auth` (más dos ganchos de invalidación de una línea en `staff` y `branches`): caché TTL de 20 s del acceso por sucursal, login/me/refresh con lecturas en paralelo, pool de conexiones que no se cierra a los 10 s, precalentamiento del pool y *keep-alive* HTTP. En local las 30 rutas de auth, staff y escritura medidas pasaron de 1107 ms a 699 ms de p50 promedio (**-37 %**); las GET de staff, **-44 %**. En producción el efecto es de pocos milisegundos (ahorra 2 consultas de ~3 ms por request) pero baja CPU y carga sobre la base.
6. La mejora individual más grande que **no** se aplicó (queda fuera de `src/common`) es activar `relationJoins` de Prisma y usar `relationLoadStrategy: 'join'` en los `include` anidados: medido en un cliente de prueba, el detalle de carta pasa de **8 consultas y 1300 a 2190 ms a 1 consulta y 440 ms** (sección 4.3).

## 1. Método

- **Servidor medido:** una instancia propia del backend compilado (`node dist/src/main`) en el puerto 8081 con `THROTTLE_LIMIT` muy alto (para que el rate limit no distorsione), apuntando a la base QA. Las pruebas "antes" corren el código compilado antes de los cambios; las "después", el código con los cambios.
- **Enumeración de rutas:** se recorrieron los 18 controladores de `src/modules/**/presentation/http` más `auth.controller.ts`. Se midieron las 41 rutas de lectura o equivalentes a lectura que aparecen en la tabla de la sección 3. No se llamó a ninguna ruta destructiva, de dinero, de publicación o de borrado de cartas.
- **Procedimiento por ruta:** 1 request en frío (el primero de esa ruta) y 5 en caliente, secuenciales, con `fetch` (keep-alive). Se informa p50 y p95 de los 5 calientes (con n=5 el p95 es prácticamente el máximo), tamaño de respuesta y número de consultas SQL. Contra Render: 1 frío y 3 calientes con 500 ms de pausa entre requests para no gatillar el rate limit.
- **"Cold" no significa servicio frío:** es el primer request de esa ruta con el pool ya usado; incluye abrir conexiones extra del pool cuando la ruta lanza consultas en paralelo (cada conexión nueva cuesta ~870 ms desde esta máquina).
- **Conteo de consultas:** un script de precarga (`node -r`) envuelve `pg.Client.prototype.query` y registra cada sentencia que sale al driver, incluidas `BEGIN` y `COMMIT` (cada una es un viaje de red). Cada request se asocia por ventana de tiempo. Es exacto para rutas secuenciales y puede tener un margen de ±1 en rutas que disparan consultas en paralelo. Nada de esto está en el repositorio.
- **Escrituras realizadas por la API (todas inocuas y repetibles):** `PUT /menus/items/:id/modifier-groups` reenviando exactamente el mismo set de grupos que ya tenía el ítem (borra y recrea las 2 filas puente con el mismo contenido), `PATCH /branches/:id` con el mismo nombre, y `POST` + `DELETE /notifications/device-tokens` con un token falso (se verificó después que no quedó ninguna fila `perf-fake`). Además `login` y `refresh` emiten tokens. `GET /orders/branch-ready-summary` puede auto-entregar pedidos, pero esa sucursal tiene `autoDeliverAfterMinutes = null`, así que no escribió. No se tocó la base con ninguna otra escritura; las sondas directas (`select 1`, `pg_stat_user_tables`, `pg_indexes`) fueron de solo lectura.
- **Dónde están los scripts:** fuera del repositorio, en `%TEMP%\sazono-perf\` (`measure.js`, `preload.js`, `dbrtt.js`, `idle.js`, `jointest.js`, resultados `result-*.json`). Son efímeros: copiarlos a un lugar estable si se quieren reutilizar.

## 2. Red y base de datos: los números que explican todo

### 2.1 RTT desde Chile (máquina del desarrollador)

| Destino | RTT medido (TCP connect) | Nota |
|---|---|---|
| AWS `sa-east-1` (São Paulo) | 58 a 72 ms | endpoint regional de DynamoDB como proxy |
| AWS `us-east-1` (Virginia) | 160 a 175 ms | |
| AWS `us-west-2` (Oregón) | 225 a 230 ms | donde están hoy Supabase y Render |
| Borde Cloudflare de Render (SCL) | 10 a 20 ms | termina TCP y TLS en Santiago |
| Render sin tocar la base (`GET /`) | TTFB 220 a 245 ms | es el viaje borde Santiago a Oregón |

El hostname de Render resuelve a un borde de Cloudflare **en Santiago** (cabecera `CF-RAY: ...-SCL`): el handshake TCP+TLS del cliente es de ~15 ms y los ~205 ms restantes son el trayecto borde a origen en Oregón. Si el backend se mueve a São Paulo sin un borde cercano, un cliente nuevo pagaría TCP+TLS completos (2 RTT de ~65 ms) en su primer request; conviene poner Cloudflare delante.

### 2.2 Conexión a la base (mismo pool y parámetros que usa la app)

Medido con `pg` y con el cliente Prisma real (`@prisma/adapter-pg`, `DATABASE_URL` por el pooler 6543):

| Medición | Resultado |
|---|---|
| `select 1` en conexión caliente | **215 ms** (RTT puro) |
| Conexión nueva (TCP + autenticación), pooler 6543 | ~870 ms (≈ 4 RTT) |
| Conexión nueva por sesión 5432 | ~870 ms (igual) |
| Conexión nueva con TLS forzado | ~1300 ms (≈ 6 RTT) |
| Primer `select 1` de Prisma con el pool frío | 1114 ms |
| `select 1` tras 12 s de inactividad (configuración anterior) | **1076 ms** |
| `select 1` tras 20, 45 y 90 s de inactividad (nueva configuración) | 215, 217 y 217 ms |

Hallazgos: (a) el pool de `pg` cierra las conexiones ociosas a los 10 s por defecto, así que en local **cualquier pausa de más de 10 s cuesta ~0,9 s extra** al siguiente request; (b) el pooler de Supabase tolera conexiones ociosas de al menos 90 s (se probó); (c) la conexión de la app **no usa TLS** (el connection string no pide `sslmode`); en Render, misma región, el costo de agregar TLS sería de unos pocos ms solo al abrir conexiones, y conviene hacerlo en producción por seguridad del tráfico, no por velocidad; (d) la base es PostgreSQL 17.6 con `max_connections = 60` y las tablas tienen del orden de 60 filas, así que el cómputo en la base es despreciable hoy.

### 2.3 Producción (Render) medido desde Chile

41 rutas, 1 frío + 3 calientes. Mínimo 203 ms, mediana **221 ms**, máximo 374 ms. Las que superan 250 ms: `POST /auth/login` 374 (incluye una llamada HTTP a Supabase Auth), `GET /staff` 315, `GET /restaurants/:id` 305, `POST /auth/refresh` 303, `GET /auth/me` 294, `GET /analytics/.../summary` 287, `GET /kitchen/station-tickets` 256, `GET /qr/tables/:qr/menu` 254. El detalle de carta, que hace 12 consultas, mide 243 ms en Render contra 2163 ms en local: confirma que en producción las consultas valen pocos ms y lo que se paga es el RTT del cliente. La compresión ya la hace el borde de Cloudflare de Render (`Content-Encoding: br` verificado con `Accept-Encoding: br`), por lo que no hace falta `compression` en la app.

## 3. Tabla de todas las rutas medidas

Columnas "Local" y "Render": p50 / p95 en ms (entre paréntesis, el primer request frío). "Queries antes→después" son consultas SQL al driver por request (±1 en rutas paralelas). El tamaño es el del cuerpo JSON sin comprimir. Las rutas públicas de QR no cambian porque no pasan por `ensureAccess`. Las filas de `platform` usan la cuenta de admin de plataforma de pruebas. `GET /restaurants/platform-metrics` responde en ~233 ms con 7 consultas "anotadas" porque su servicio la cachea internamente (el primer request tarda 1118 ms).

| Grupo | Endpoint | Tamaño | Queries antes→después | Local antes p50 / p95 (cold) | Local después p50 / p95 (cold) | Render p50 / p95 (cold) |
|---|---|---|---|---|---|---|
| auth | `POST /auth/login` | 1.2 KB | 5→5 | 1177 / 1195 (1160) | 954 / 965 (991) | 374 / 408 (371) |
|  | `GET /auth/me` | 376 B | 4→4 | 876 / 905 (858) | 656 / 669 (656) | 294 / 299 (360) |
|  | `POST /auth/refresh` | 1.2 KB | 4→4 | 874 / 877 (886) | 665 / 669 (671) | 303 / 305 (270) |
| public | `GET /restaurants/search?q=bel` | 39 B | 1→2 | 231 / 235 (235) | 232 / 248 (240) | 204 / 208 (203) |
|  | `GET /restaurants/by-slug/:slug` | 35 B | 1→1 | 232 / 233 (232) | 233 / 235 (233) | 203 / 216 (204) |
|  | `GET /qr/tables/:qr/menu` | 11.9 KB | 12→12 | 2172 / 2181 (3056) | 2177 / 2199 (2185) | 254 / 258 (680) |
|  | `GET /qr/tables/:qr/orders` | 3.1 KB | 8→8 | 1106 / 1107 (1101) | 1098 / 1113 (1104) | 223 / 240 (378) |
|  | `GET /qr/tables/:qr/bill` | 154 B | 3→3 | 667 / 668 (672) | 667 / 1078 (670) | 213 / 216 (228) |
|  | `GET /qr/tables/:qr/payment-config` | 111 B | 3→3 | 658 / 665 (675) | 660 / 669 (666) | 213 / 227 (216) |
|  | `GET /qr/tables/:qr/bill/splits/current` | 0 B | 6→5 | 1099 / 1105 (1107) | 1109 / 1111 (1104) | 217 / 221 (218) |
| branches | `GET /branches` | 372 B | 5→3 | 876 / 891 (886) | 452 / 453 (890) | 217 / 241 (221) |
| staff | `GET /staff` | 2.2 KB | 5→3 | 1639 / 1667 (1686) | 896 / 908 (1293) | 315 / 360 (411) |
| menus | `GET /menus?branchId` | 798 B | 7→4 | 1092 / 1095 (1528) | 670 / 672 (673) | 217 / 223 (246) |
|  | `GET /menus/:id` | 11.9 KB | 12→10 | 2163 / 2858 (3029) | 1752 / 2204 (1742) | 243 / 248 (296) |
|  | `GET /menus/modifier-groups` | 6.3 KB | 4→2 | 871 / 875 (880) | 456 / 464 (451) | 217 / 218 (222) |
|  | `GET /menus/preparation-stations` | 690 B | 3→1 | 652 / 658 (663) | 231 / 236 (232) | 210 / 211 (213) |
| floor | `GET /floor/tables` | 1.1 KB | 6→3 | 1092 / 1095 (1096) | 668 / 669 (669) | 220 / 225 (221) |
|  | `GET /floor/zones` | 2 B | 5→3 | 885 / 889 (1753) | 438 / 449 (450) | 215 / 246 (1027) |
|  | `GET /floor/counter-sessions` | 15.1 KB | 5→3 | 884 / 1096 (1103) | 451 / 456 (451) | 221 / 225 (225) |
|  | `GET /floor/branch-staff` | 488 B | 4→2 | 880 / 882 (886) | 450 / 458 (460) | 219 / 252 (240) |
|  | `GET /floor/tables/:id/current-session` | 313 B | 6→4 | 1091 / 1097 (1099) | 665 / 1096 (673) | 236 / 247 (244) |
| orders | `GET /orders?tableSessionId` | 2 B | 9→7 | 1308 / 1316 (2184) | 887 / 889 (884) | 228 / 230 (236) |
|  | `GET /orders/branch-ready-summary` | 2 B | 7→5 | 1313 / 1319 (1326) | 890 / 909 (906) | 230 / 235 (226) |
| kitchen | `GET /kitchen/station-tickets` | 28.8 KB | 10→8 | 1527 / 1541 (1750) | 1094 / 1101 (1318) | 256 / 291 (322) |
| billing | `GET /billing/table-sessions/:id/current-bill` | 337 B | 5→2 | 887 / 892 (883) | 441 / 452 (884) | 210 / 211 (194) |
|  | `GET /billing/branches/:b/open-bills` | 13.7 KB | 5→4 | 883 / 887 (874) | 451 / 454 (457) | 244 / 247 (214) |
| payments | `GET /payments/bills/:id` | 2 B | 4→3 | 875 / 882 (910) | 447 / 455 (463) | 213 / 216 (215) |
|  | `GET /payments/bills/:id/splits/current` | 0 B | 5→3 | 1103 / 1112 (1107) | 671 / 683 (668) | 215 / 241 (214) |
|  | `GET /payment-accounts/mercado-pago` | 1.3 KB | 3→1 | 669 / 674 (667) | 232 / 235 (235) | 208 / 211 (207) |
|  | `GET /payment-accounts/transbank` | 293 B | 4→1 | 656 / 665 (670) | 231 / 234 (221) | 208 / 236 (213) |
| analytics | `GET /analytics/branches/:b/summary` | 938 B | 11→9 | 1103 / 1105 (2039) | 667 / 679 (1567) | 287 / 304 (577) |
| reports | `GET /reports/branches/:b/sales-by-order` | 30.8 KB | 8→4 | 1313 / 1328 (1322) | 679 / 685 (1339) | 230 / 231 (235) |
|  | `GET /reports/branches/:b/sales-by-hierarchy` | 1.2 KB | 5→3 | 1102 / 1111 (1092) | 671 / 679 (683) | 221 / 223 (326) |
|  | `GET /reports/branches/:b/payments` | 27.4 KB | 6→4 | 1095 / 1101 (1102) | 672 / 680 (671) | 225 / 229 (229) |
| platform | `GET /restaurants` | 604 B | 2→1 | 233 / 236 (218) | 233 / 235 (234) | 231 / 270 (207) |
|  | `GET /restaurants/platform-metrics` | 947 B | 7→8 | 233 / 234 (1118) | 234 / 679 (235) | 203 / 232 (252) |
|  | `GET /restaurants/:id` | 2.0 KB | 5→5 | 1117 / 1139 (1108) | 1115 / 1129 (1363) | 305 / 471 (584) |
|  | `GET /leads` | 2 B | 1→2 | 220 / 229 (233) | 236 / 240 (231) | 212 / 219 (198) |
| writes | `PUT /menus/items/:id/modifier-groups (same set)` | 2.8 KB | 11→10 | 2378 / 2543 (2390) | 1974 / 1998 (2419) | 238 / 246 (417) |
|  | `PATCH /branches/:id (same name)` | 370 B | 8→7 | 1727 / 1751 (1731) | 1320 / 1325 (1326) | 225 / 254 (229) |
|  | `POST /notifications/device-tokens (fake, deleted after)` | 0 B | 1→2 | 230 / 234 (221) | 227 / 238 (223) | 233 / 245 (210) |

Rutas con mutación enumeradas en los controladores y **no medidas** a propósito (dinero, estado o destrucción): `POST /menus` (y sus hijas de creación), `PATCH` de categorías/ítems/grupos/opciones, `POST .../publish`, subida y borrado de imágenes, `POST /floor/*` (abrir, cerrar, abandonar, asignar sesiones, zonas, mesas), `POST /orders`, `/deliver`, `/cancel`, `POST /kitchen/station-tickets/:id/status`, todo `POST` de `payments`, `payment-accounts`, `qr/.../pay*`, `qr/.../orders` (creación), `webhooks/payments/*`, `POST /staff`, `PATCH /staff/:id`, `POST /branches`, `POST /restaurants/bootstrap`, `PATCH /restaurants/:id`, `POST /leads`, `POST /auth/pin/*`. Su costo se puede inferir por el mismo modelo: viajes secuenciales a la base × RTT.

### 3.1 Las 15 más lentas (local, antes) con consultas por request

| # | Endpoint | p50 local antes | Queries | Tablas consultadas (orden de término) |
|---|---|---|---|---|
| 1 | `PUT /menus/items/:id/modifier-groups (same set)` | 2378 ms | 11→10 | menu_items, menu_categories, menus, staff_users, staff_user_branch_roles, modifier_groups, modifier_options, BEGIN, DELETE menu_item_modifier_groups, INSERT menu_item_modifier_groups, COMMIT |
| 2 | `GET /qr/tables/:qr/menu` | 2172 ms | 12→12 | tables, branches, branch_settings, menus×2, menu_categories, menu_items, menu_item_modifier_groups, preparation_stations, menu_item_media, modifier_groups, modifier_options |
| 3 | `GET /menus/:id` | 2163 ms | 12→10 | menus, menu_categories, menu_items, preparation_stations, menu_item_modifier_groups, menu_item_media, modifier_groups, modifier_options, branch_settings, staff_users, staff_user_branch_roles, translations |
| 4 | `PATCH /branches/:id (same name)` | 1727 ms | 8→7 | staff_users, branches×2, BEGIN, UPDATE branches, branch_settings, COMMIT |
| 5 | `GET /staff` | 1639 ms | 5→3 | staff_users×2, staff_user_branch_roles, branches |
| 6 | `GET /kitchen/station-tickets` | 1527 ms | 10→8 | staff_users, staff_user_branch_roles, station_tickets, preparation_stations, station_ticket_items, orders, order_items, table_sessions, order_item_modifiers, tables |
| 7 | `GET /orders/branch-ready-summary` | 1313 ms | 7→5 | staff_users, staff_user_branch_roles, branch_settings, orders, table_sessions, station_tickets, tables |
| 8 | `GET /reports/branches/:b/sales-by-order` | 1313 ms | 8→4 | staff_users, staff_user_branch_roles, branches, restaurants,  SELECT COALESCE(p.method, bills,  SELECT e.id::text AS id,,  SELECT p.id::text AS id, |
| 9 | `GET /orders?tableSessionId` | 1308 ms | 9→7 | table_sessions, staff_users, staff_user_branch_roles, orders, station_tickets, order_items, order_item_modifiers, preparation_stations×2 |
| 10 | `POST /auth/login` | 1177 ms | 5→5 | restaurants, platform_admins, staff_users, staff_user_branch_roles, branches |
| 11 | `GET /qr/tables/:qr/orders` | 1106 ms | 8→8 | tables, table_sessions, orders, station_tickets, order_items, preparation_stations×2, order_item_modifiers |
| 12 | `GET /payments/bills/:id/splits/current` | 1103 ms | 5→3 | bills, staff_users, staff_user_branch_roles, bill_splits, bill_split_participants |
| 13 | `GET /analytics/branches/:b/summary` | 1103 ms | 11→9 | staff_users, staff_user_branch_roles, branches, restaurants, tables×2, payments×2, order_items, table_sessions, orders |
| 14 | `GET /reports/branches/:b/sales-by-hierarchy` | 1102 ms | 5→3 | staff_users, staff_user_branch_roles, branches, restaurants,  SELECT oi.category_path_ |
| 15 | `GET /qr/tables/:qr/bill/splits/current` | 1099 ms | 6→5 | bill_split_participants×2, tables, table_sessions, bills, bill_splits |

Las consultas de `staff_users` + `staff_user_branch_roles` que se repiten en casi todas son el control de acceso por sucursal (`BranchAccessService.ensureAccess`): **2 viajes secuenciales en cada request autenticado**.

## 4. Diagnóstico con evidencia

### 4.1 La latencia es distancia, no cómputo

- Local: `GET /menus/:id` = 2163 ms con 12 consultas distribuidas en ~10 niveles secuenciales (10 × 215 ms = 2150 ms). El 99 % del tiempo es red hacia Oregón.
- Render: la misma ruta mide 243 ms; sin base (`GET /`) mide 204 a 245 ms. Cuesta ~40 ms por encima del piso, con 12 consultas y la serialización de 12 KB.
- La mediana de Render (221 ms) está a ~15 ms del piso de red Chile a Oregón.

Cómo leer los números: en producción `latencia ≈ RTT(Chile, backend) + consultas_secuenciales × RTT(backend, base) + cómputo`. Hoy el segundo término es ~2 a 5 ms por consulta y el primero 205 ms.

### 4.2 Control de acceso con 2 viajes por request (resuelto)

`ensureAccess` hacía `staffUser.findFirst({ include: { branchRoles } })`. Con Prisma 7 y el adaptador de `pg` un `include` es **una consulta por relación**, así que cada request autenticado pagaba 2 viajes (`staff_users` y luego `staff_user_branch_roles`) antes de la consulta de negocio. En local son 430 ms por request; en Render, ~5 ms. `JwtAuthGuard` y `ProfileTypeGuard` no consultan la base (solo validan el JWT), por lo que este era el único costo de autenticación por request. Ver sección 5.

### 4.3 Prisma resuelve cada `include` con consultas separadas

La carta (`GET /menus/:id`, `GET /qr/tables/:qr/menu`) hace entre 8 y 12 consultas porque cada nivel de `include` anidado es una consulta aparte. Experimento (cliente de prueba generado en un directorio temporal con `previewFeatures = ["relationJoins"]`, misma consulta del detalle de carta, mismos 20 082 bytes de resultado, base QA):

| Estrategia | Consultas | Tiempo |
|---|---|---|
| `relationLoadStrategy: 'query'` (comportamiento actual) | 8 | 2189 ms y 1302 ms |
| `relationLoadStrategy: 'join'` | 1 | 445 ms y 436 ms |

El cliente generado hoy **no expone** `relationLoadStrategy` (no está activado el *preview feature*), por eso ningún `include` del repositorio lo usa. Cambiarlo implica editar `prisma/schema.prisma` (solo el bloque `generator`, no es una migración), regenerar el cliente y agregar la opción por consulta en los servicios (o centralizarla). No se hizo en este estudio porque la mayoría de los `include` pesados viven en `menus`, `kitchen`, `orders` y `floor`, y por regenerar el cliente de `node_modules` mientras otros agentes trabajaban. Es la mejora de código de mayor retorno restante (listas por módulo en la sección 7).

### 4.4 Conexiones: pool, arranque en frío y pooler

- `PrismaService` creaba `PrismaPg({ connectionString })` sin opciones: `max` 10, `idleTimeoutMillis` 10 s (default de `pg-pool`), sin *keep-alive* TCP, y con `PRISMA_CONNECT_ON_STARTUP=false` el primer request del proceso pagaba la conexión (1,1 s local). Ver sección 5 para el ajuste.
- Pooler: se usa el modo transacción (6543, `?pgbouncer=true`) para la app y el 5432 para migraciones (`DIRECT_URL`). Es lo correcto: el modo transacción no soporta *prepared statements* con nombre ni pipelining, y la configuración actual funciona sin errores en este modo (todas las rutas medidas respondieron bien). No hay beneficio de velocidad en cambiar de modo (ambos miden 215 ms por consulta y 870 ms por conexión nueva). El pooler dedicado (plan Pro) sí soporta prepared statements pero tampoco reduce el RTT.
- Con `max_connections = 60` en la base y `max` 10 por instancia hay holgura para varias instancias; no subir `max`.

### 4.5 Auth: lecturas encadenadas que podían ir en paralelo (resuelto)

- `POST /auth/login`: `signInWithPassword` (HTTP a Supabase Auth) y después la búsqueda del slug del restaurante y después las consultas de perfil. El slug no depende del resultado del login: ahora corre en paralelo.
- `GET /auth/me` y `POST /auth/refresh`: `getUserById` (HTTP a la API de admin de Supabase) y después las consultas de perfil, que solo necesitan `payload.sub`. Ahora van en paralelo.
- Todo el tráfico de `me`/`refresh` incluye una llamada HTTP al proyecto Supabase (en Oregón), por lo que `me` y `refresh` no bajan de ~290 a 300 ms en producción. Si la app los llama seguido (arranque de la app móvil), conviene que `me` salga de los datos del JWT y se refresque solo al renovar sesión (decisión de producto, no cambia la seguridad si el refresh sigue validando contra Supabase).

### 4.6 Payload, compresión y keep-alive

- Compresión: el backend no comprime (no hay middleware `compression`), pero **no hace falta**: Render pasa por Cloudflare, que entrega `br`. Lo que sí pesa es el tamaño bruto en CPU de serialización y memoria: `kitchen/station-tickets` 28,8 KB, `reports/.../sales-by-order` 30,8 KB, `reports/.../payments` 27,4 KB, `floor/counter-sessions` 15,1 KB, `billing/.../open-bills` 13,7 KB, carta 11,9 KB.
- Keep-alive: Node cierra conexiones inactivas a los 5 s por defecto, menos que el tiempo de inactividad habitual de los proxies (Render y Cloudflare), lo que puede generar reconexiones y 502 esporádicos. Se fija `keepAliveTimeout` en 65 s y `headersTimeout` en 66 s (ver sección 5).
- `ValidationPipe` con `transform` y `enableImplicitConversion`: costo de microsegundos por request, sin impacto medible. Sin interceptores globales. El logger (`pino-http`) está en nivel `info` en desarrollo y `LOG_LEVEL` configurable; no se midió impacto.
- ETag débil de Express activo (`etag: W/"..."`): permite respuestas 304 si el cliente reenvía `If-None-Match`, pero no ahorra consultas.

### 4.7 Índices

Hoy las tablas tienen ~60 filas (`pg_stat_user_tables`), así que ningún índice cambia la latencia y los `seq_scan` que aparecen son normales para tablas tan chicas. Para cuando el volumen crezca, estos son los índices recomendados, contrastados con los patrones `WHERE`/`ORDER BY` de las consultas calientes. **No se creó ninguna migración**; son sentencias para revisar:

```sql
CREATE INDEX CONCURRENTLY orders_branch_created_status_idx
  ON orders (branch_id, created_at, status);

CREATE INDEX CONCURRENTLY station_ticket_items_order_item_id_idx
  ON station_ticket_items (order_item_id);

CREATE INDEX CONCURRENTLY payments_bill_status_paid_at_idx
  ON payments (bill_id, status, paid_at);

CREATE INDEX CONCURRENTLY station_tickets_branch_sent_idx
  ON station_tickets (branch_id, sent_at, created_at)
  WHERE status <> 'READY';

CREATE INDEX CONCURRENTLY payment_attempts_bill_created_idx
  ON payment_attempts (bill_id, created_at);
```

Justificación: `orders (branch_id, created_at, status)` sirve a `groupOrdersByStatusInRange` de analytics (el índice actual `(branch_id, status)` no cubre el rango por fecha); `station_ticket_items (order_item_id)` cubre la relación inversa (el único índice único es `(station_ticket_id, order_item_id)`) y hoy tiene 91 `seq_scan` contra 9 `idx_scan`; `payments (bill_id, status, paid_at)` sirve a las subconsultas correlacionadas `MAX(paid_at)` por cuenta de los reportes `sales-by-order`/`payments`; el índice parcial de `station_tickets` sirve a la lista de cocina (`ORDER BY sent_at, created_at` con filtro de estado). El último es opcional: aplicarlo solo si se consulta por ese patrón. Ya existen y están bien: `bills (branch_id, closed_at)`, `table_sessions (branch_id, status)` y los parciales de mostrador, `staff_users (auth_user_id, restaurant_id)` único, `restaurants.slug` único, `tables.qr_token` único, `translations (entity_type, entity_id, locale, field_name)`.

### 4.8 Riesgo: rate limit compartido (no es velocidad, pero se manifiesta como lentitud y errores 429)

`ThrottlerGuard` es global con 100 req/60 s y rastrea por `req.ip`. `main.ts` no configura `trust proxy`, así que detrás de Render (y de Cloudflare) `req.ip` es la dirección del proxy, no la del cliente. Evidencia: contra Render, `x-ratelimit-remaining` baja 99, 98, 97, 96 incluso cuando se envían cabeceras `X-Forwarded-For` distintas (9.9.9.9, 8.8.4.4): la clave no depende de la IP declarada del cliente. La UI además llama al backend desde el servidor de Next (`/api/backend`), con lo que todos sus usuarios llegan por una sola IP de salida. Consumo de referencia por pantalla abierta (intervalos del código de `sazono-ui`): cocina 7,5 req/min (8 s), mostrador 7,5, salón ~13 (15 s, 15 s y 12 s), cada comensal en QR 12 (órdenes y cuenta cada 10 s). Un restaurante con 1 cocina, 2 salones, 1 mostrador y 20 comensales ya consume ~280 req/min. Si el balde es realmente compartido, el límite se alcanza con una sola sucursal ocupada. Acción propuesta en la sección 6 (verificar con un log de `req.ip` y configurar `trust proxy` con el número de saltos correcto; es un cambio de seguridad, por eso no se aplicó aquí).

### 4.9 Plan gratuito de Render

Los servicios gratuitos se suspenden tras 15 min sin tráfico y el primer request despierta el servicio en ~1 minuto; hay 750 horas gratuitas por mes y el servicio puede reiniciarse en cualquier momento (documentación de Render). Es muy probablemente la mayor causa de lentitud percibida en la primera apertura del día. Render no tiene región en Sudamérica (Oregón, Ohio, Virginia, Frankfurt y Singapur) y no permite mover un servicio de región: habría que crear uno nuevo.

### 4.10 Polling del frontend

Intervalos en `sazono-ui`: cocina 8 s (`TICKETS_REFETCH_INTERVAL`), mostrador 8 s, salón 15 s + 15 s + resumen "listo" 12 s, QR 10 s + 10 s. Cada tick cuesta ~205 ms de latencia al cliente y 4 a 10 consultas al backend. `GET /orders/branch-ready-summary` es un GET con efecto lateral (auto-entrega pedidos cuando la sucursal lo configura): no se puede cachear ni reintentar sin pensar.

## 5. Mejoras aplicadas y resultados

Reglas respetadas: sin comentarios en el código nuevo, sin tocar `menus`, `reports` ni `kitchen`, comportamiento funcional idéntico, sin migraciones ni commits. Verificación: `npx tsc --noEmit` limpio, ESLint limpio en lo modificado, `npx jest` completo **120 suites, 881 tests, todo en verde**.

### 5.1 Caché TTL del acceso del staff (`BranchAccessService`)

- Archivos nuevos: `src/common/cache/cache-store.ts` (interfaz asíncrona `CacheStore` con `get/set/delete`, pensada para poder respaldarla con Redis después), `in-memory-cache.store.ts` (implementación en proceso con vencimiento por TTL y tope de 5000 entradas), `cache.module.ts` (módulo global) y su spec.
- `src/common/branch-access/branch-access.service.ts`: `ensureAccess` y `getStaffContext` leen una sola vez el `staffUser` activo con todos sus roles activos y lo guardan **20 s** por `staffUserId` (clave `staff-access:<id>`). Se guarda solo el resultado positivo (usuario activo); si la base dice que no está activo se borra la entrada.
- **Semántica de seguridad (documentada, TTL de 20 s):**
  - Revocar un rol o desactivar a un staff deja de surtir efecto, como máximo, a los 20 s en otra instancia del backend; en la misma instancia es inmediato porque `UpdateStaffUserService` llama a `invalidateStaff(id)` tras el cambio.
  - Si el acceso se **deniega** con datos de caché, se vuelve a leer la base antes de rechazar (cubre altas de rol recientes, por ejemplo un admin que acaba de crear otra sucursal). `CreateBranchService` también invalida al terminar.
  - El `restaurantId` del JWT se compara con el de la entrada; si no coincide no se reutiliza.
  - Los mensajes de error y las reglas de rol son los mismos de antes.
  - El JWT sigue siendo válido hasta su expiración (1 h) como antes; esto no cambia.
- Specs nuevos (`branch-access.service.spec.ts`, `in-memory-cache.store.spec.ts`) cubren: una sola consulta reutilizada entre sucursales, recarga y rechazo tras vencer el TTL, rechazo inmediato tras `invalidateStaff`, revalidación contra la base antes de denegar, rechazo sin segunda consulta cuando la lectura fue fresca, perfil no staff, otro restaurante y `getStaffContext` compartiendo la misma entrada.
- Efecto medido en local: cada ruta autenticada pierde 2 viajes (~430 ms). Ejemplo: `GET /menus/preparation-stations` 652 a 231 ms; `GET /payment-accounts/mercado-pago` 669 a 232 ms; `GET /floor/branch-staff` 880 a 450 ms.

### 5.2 Auth en paralelo (`src/modules/auth/auth.service.ts`)

- `login`: la búsqueda del slug va en paralelo al `signInWithPassword`.
- `getCurrentUser` (usado por `me` y `refresh`): `getUserById` en paralelo a la lectura de `platformAdmin` y `staffUser`; la resolución del perfil se separó en `findProfileRecords` + `resolveProfileFromRecords` sin cambiar reglas ni errores.
- Specs nuevos en `auth.service.spec.ts` (el slug se consulta con el login aún pendiente; credenciales inválidas siguen rechazando aunque el slug exista; perfil leído con la identidad aún pendiente; sesión inválida si la identidad no existe).
- Medido en local: login 1177 a 954 ms, me 876 a 656 ms, refresh 874 a 665 ms.

### 5.3 Pool de conexiones y arranque (`src/common/prisma/prisma.service.ts`)

- `idleTimeoutMillis: 300000` y `keepAlive: true` en el pool (antes 10 s y sin keep-alive); se verificó que el pooler de Supabase mantiene la conexión viva al menos 90 s.
- Consulta `SELECT 1` de precalentamiento no bloqueante en `onModuleInit` (errores ignorados). Primer request del proceso: **1147 ms a 241 ms** (`GET /restaurants/by-slug/:slug`, medido en local).
- `max` y demás parámetros se mantienen.

### 5.4 Keep-alive HTTP (`src/main.ts`)

`keepAliveTimeout = 65000` y `headersTimeout = 66000` en el servidor HTTP, por encima del tiempo de inactividad de los proxies. No se agregó compresión (ya la hace el borde de Render).

### 5.5 Gancho de invalidación en dos servicios fuera de `src/common`

`UpdateStaffUserService` e `CreateBranchService` llaman a `branchAccessService.invalidateStaff(...)` al terminar (una línea y su spec cada uno). Son los dos únicos puntos del código que cambian roles o estado de un staff ya existente.

### 5.6 Antes y después (local, 30 rutas autenticadas)

p50 promedio 1107 ms a 699 ms (**-37 %**); promedio de las 25 GET de staff: **-44 %**. Todas las filas están en la tabla de la sección 3. Algunos casos: `/branches` 876 a 452; `/staff` 1639 a 896; `/menus?branchId` 1092 a 670; `/menus/modifier-groups` 871 a 456; `/billing/table-sessions/:id/current-bill` 887 a 441; `/payment-accounts/transbank` 656 a 231; `/reports/.../sales-by-order` 1313 a 679; `PATCH /branches/:id` 1727 a 1320; `PUT .../modifier-groups` 2378 a 1974 (queda dominado por las 4 consultas encadenadas del `include` y por la transacción `BEGIN`/`DELETE`/`INSERT`/`COMMIT`).

## 6. Plan priorizado

### 6.1 Ahora (código y configuración, costo 0)

| # | Acción | Dónde | Ganancia esperada |
|---|---|---|---|
| 1 | **Evitar el spin-down** de Render: plan de pago (Starter, del orden de US$7/mes, verificar precio vigente) o, mientras tanto, un ping cada 10 min | Render | Elimina esperas de ~1 min al despertar. Es lo que más percibe un usuario real |
| 2 | **Región de la función de Vercel = `pdx1`** (Portland) mientras el backend esté en Oregón (hoy el default es `iad1`, Washington). Ajuste en *Settings > Functions > Function Regions* o `vercel.json` `regions` | Vercel | ~60 a 70 ms menos por llamada proxificada (trayecto Virginia a Oregón) |
| 3 | **Corregir el rate limit compartido**: confirmar con un log de `req.ip` y configurar `trust proxy` con los saltos correctos (Cloudflare + Render), o hacer que la UI reenvíe la IP real y usar esa clave | `main.ts` / `ThrottlerGuard` | Evita 429 con tráfico real; no es velocidad pero hoy puede parecer lentitud |
| 4 | Activar `relationJoins` y `relationLoadStrategy: 'join'` en los `include` anidados de las rutas calientes (sección 7) | `prisma/schema.prisma` + servicios | Local: -1,7 s en carta; producción: -10 a 40 ms de CPU/espera por ruta y menos presión sobre la base |
| 5 | Cachear la carta pública del QR: en el servidor (clave `menuId` + versión, invalidar en publicar/renombrar/eliminar) **y** en el borde con la caché de datos de Next (`revalidate` de 15 a 60 s con `stale-while-revalidate`) | `menus` + UI | La ruta del comensal pasa de ~254 ms a la latencia del CDN (decenas de ms): elimina el RTT a Oregón |
| 6 | Reducir round trips del cliente: una ruta agregadora por pantalla de salón/cocina y subir los intervalos de polling (8 a 15 s en cocina si el producto lo tolera) | UI + backend | Cada request que desaparece ahorra ~205 ms de espera y consultas |
| 7 | Mantener lo aplicado en la sección 5; cachear también `GET /branches` y `GET /staff` ya queda cubierto por `getStaffContext` | `src/common` | hecho |
| 8 | TLS en la conexión a la base en producción (`sslmode=require` o `ssl` en el pool) | `prisma.service.ts` / env | Seguridad; +2 RTT solo al abrir conexiones (~6 ms en Render) |

### 6.2 Infraestructura (1 a 3 semanas, con costo)

| Opción | Qué es | Ganancia esperada | Costo y riesgos |
|---|---|---|---|
| **A. Mover backend y base a São Paulo** (recomendada si se busca velocidad real) | Proyecto Supabase nuevo en `sa-east-1`, backend en `sa-east-1` (Fly.io `gru`, Cloud Run `southamerica-east1` o ECS/App Runner en AWS) y Vercel `gru1`; Cloudflare delante para terminar TLS cerca | Piso de red de ~205 ms a ~65 ms. Endpoints de 220 ms pasarían a ~75 a 110 ms (**-50 a -65 %**). El backend y la base quedan en la misma región (1 a 3 ms por consulta) | Render no tiene región en Sudamérica. Supabase no permite cambiar la región de un proyecto: se crea uno nuevo y se migran datos (`pg_dump`/restore incluyendo `auth.users`), Storage y Edge Functions aparte; cambian URL, claves, `DATABASE_URL`, callbacks de OAuth (Mercado Pago, Transbank) y webhooks. Ventana de corte corta (la base es QA). Costo de hosting distinto de US$0 |
| B. Backend en Santiago (Cloud Run `southamerica-west1`) con la base en Oregón o São Paulo | Backend cerca del cliente | Solo conviene si la base también está en Chile. Con la base en São Paulo (~60 ms por consulta) un endpoint de 10 consultas secuenciales costaría 600 ms: **empeora**. No recomendado sin antes reducir las consultas por request a 2 o 3 (joins) | Complejidad alta |
| C. Esperar la región AWS de Chile | AWS anunció una región en Chile (fecha prevista fin de 2026, verificar disponibilidad en Supabase) | Piso de red de ~10 a 20 ms si Supabase la ofrece | Incierto; revisar el listado de regiones de Supabase |
| D. Quedarse en Oregón y optimizar | Plan 6.1 completo | Mediana ~215 ms (piso 205 ms). Cualquier mejora adicional se pierde en el RTT | Costo 0 |

Orden sugerido: 6.1 completo, luego A cuando haya presupuesto, sin pasar por B.

### 6.3 Redis, réplicas y otros: cuándo ayudan

- **Redis (Upstash o similar): hoy no ayuda a la velocidad.** El RTT backend a base en producción es de 2 a 5 ms, igual que el de un Redis en la misma región; reemplazar una consulta por una lectura de Redis no gana nada. El cliente nunca habla con Redis, así que tampoco baja el piso de 205 ms. Sí tiene valor para: invalidación de caché entre varias instancias (hoy cada instancia tiene su caché de 20 s), rate limit distribuido, publicación/suscripción para empujar eventos a cocina y salón en vez de polling, colas. Upstash ofrece `us-west-2` y `sa-east-1`; el plan gratis es de 500 mil comandos al mes, de modo que el polling actual lo agotaría rápido. La interfaz `CacheStore` ya permite enchufarlo (ver 5.1).
- **Réplicas de lectura de Supabase: no ayudan.** Replican asincrónicamente (hay *replication lag*), cobran el mismo cómputo que el primario más disco al 1,25× y solo se justifican cuando el primario supera el 70 % de CPU sostenido con consultas ya optimizadas (guía de Supabase). Con tablas de ~60 filas y un solo restaurante de pruebas no hay nada que repartir. Una réplica en São Paulo con el primario en Oregón dejaría las escrituras a 180 ms.
- **Caché de borde (CDN) sí ayuda** para lo público y estable: carta del QR, búsqueda por slug (`restaurants/by-slug` responde 35 bytes). No cachear rutas autenticadas ni con efecto lateral.

### 6.4 Qué NO hacer

1. No añadir Redis "para ir más rápido": con la base a 2 a 5 ms no baja nada y agrega un servicio y fallos nuevos.
2. No comprar réplicas de lectura ni subir el cómputo de la base: las tablas tienen ~60 filas.
3. No mover solo el backend a otra región sin mover la base (cada consulta pasaría a costar el RTT entre regiones).
4. No agregar el middleware `compression`: Cloudflare ya entrega `br`.
5. No subir `max` del pool ni tocar el modo del pooler: no reducen el RTT y la base permite solo 60 conexiones.
6. No cachear datos mutables sin invalidación explícita; no cachear respuestas autenticadas en el borde.
7. No optimizar SQL ni crear índices para la latencia actual (el cómputo en la base es despreciable); los índices de 4.7 son para cuando crezca el volumen.
8. No aumentar el TTL de la caché de acceso por encima de 30 s sin un invalidador entre instancias.

## 7. Hotspots por módulo (código no modificado)

Todo lo siguiente quedó **sin tocar** porque otros agentes trabajan en `menus`, `reports` y `kitchen` (los demás módulos no estaban en el alcance de las mejoras rápidas). Cada ítem indica la ruta exacta, el patrón y el arreglo sugerido. Las consultas se midieron con el hook de `pg` (sección 1).

### 7.1 `src/modules/menus`

| Archivo | Problema (evidencia) | Arreglo sugerido |
|---|---|---|
| `application/get-menu-detail.service.ts` (`GET /menus/:id`, 2163 ms local, 12 consultas) | Árbol completo con `include` de 5 niveles (categorías, ítems, estación, media, grupos, opciones) = 8 consultas; después `branchSettings.findUniqueOrThrow`, `ensureAccess` y `translation.findMany` **en serie** | `relationLoadStrategy: 'join'` (1 consulta); ejecutar `branchSettings`, `ensureAccess` y `translations` con `Promise.all` tras leer el menú. Medido: 8 consultas a 1 consulta, 2189 a 445 ms |
| `application/get-published-menu-by-qr.service.ts` (`GET /qr/tables/:qr/menu`, 2172 ms local, 12 consultas; 254 ms en Render) | Ruta pública y la más caliente del cliente: `table` con `branch.settings.defaultMenu` anidado (4 consultas) y luego el árbol completo del menú (8) en cada visita, aunque la carta publicada no cambia | Join (1 a 2 consultas) + caché por `qrToken`/`menuId`+`version` con TTL de 30 a 60 s invalidada en `publish`/`update`/`delete`/`duplicate`/edición de ítems, y caché en el borde (6.1 punto 5). Con `locale` distinto del idioma de la carta suma otra consulta de `translation`: incluirla en el mismo `Promise.all` o precalcularla |
| `application/set-menu-item-modifier-groups.service.ts` (`PUT /menus/items/:id/modifier-groups`, 2378 ms local, 11 consultas) | `item` con `menuCategory.menu` anidado (3 consultas), `ensureAccess` (hoy cacheado), `modifierGroup.findMany` con opciones (2) y luego `$transaction([deleteMany, createMany])` = `BEGIN`+2+`COMMIT` | Join para el ítem; contar grupos con `count` en vez de traerlos con opciones y leer opciones solo para la respuesta; omitir la escritura si el conjunto no cambia; reemplazar delete+create por una sola sentencia SQL. Pasa de 11 a entre 3 y 6 viajes |
| `application/list-menus.service.ts` (`GET /menus?branchId`, 1092 ms local, 7 consultas) | `menu.findMany({ include: { categories: { include: { items: true } } } })` trae **todas las filas de ítems de todas las cartas** solo para contar | `_count` de categorías por carta y `groupBy` de ítems por carta (2 consultas ligeras, sin crecer con el catálogo) |
| `application/list-modifier-groups.service.ts` y `list-preparation-stations.service.ts` | 4 y 3 consultas (2 y 1 tras la caché). Aceptables | Ninguna urgente; sin paginación, aceptable a este tamaño |
| `presentation/http/menus.controller.ts` | Rutas `POST/PATCH/PUT` de edición repiten el patrón `findUnique` con include + `ensureAccess` + `transaction` (3 a 5 viajes secuenciales) | Resolver `branchId` con un `select` mínimo, hacer `ensureAccess` en paralelo cuando la lectura no depende de él y evitar leer el recurso completo si solo se valida pertenencia |

### 7.2 `src/modules/reports`

| Archivo | Problema | Arreglo sugerido |
|---|---|---|
| `application/report-scope.service.ts` (`resolve` y `resolveAccess`, líneas ~76 y ~118) y `infrastructure/reports.prisma.repository.ts` `findBranchTimezone` (~243) | Antes de la consulta del reporte hay 4 viajes en serie: `ensureAccess` (2, ahora 0 con caché), `branch.findUnique` y luego `restaurant` para la zona horaria. Ese es el 80 % del tiempo de `sales-by-hierarchy` (5 consultas, solo 1 es el reporte) | Una sola consulta `branch.findUnique({ select: { restaurantId, restaurant: { select: { timezone } } } })` (join) o `$queryRaw`; ahorra 1 viaje y deja el costo del reporte en 1 a 2 viajes |
| `reports.prisma.repository.ts` `$queryRaw` de `sales-by-order` (~260 y ~305) | `COUNT(*) FROM (SELECT ... CROSS JOIN LATERAL (SELECT MAX(lp.paid_at) FROM payments lp ...))`: subconsultas correlacionadas por cuenta; hoy instantáneas (62 cuentas) pero escalan con el número de cuentas | Índice `payments (bill_id, status, paid_at)` (sección 4.7) y, si se vuelve lento, materializar `closed_at` efectivo en `bills` |
| Páginas de 27 a 31 KB (`sales-by-order`, `payments`) | Respuesta JSON grande por defecto | Límite por defecto más bajo (`limit`) y, para cierres, preferir `format=csv` en streaming (ya existe) |

### 7.3 `src/modules/kitchen`

| Archivo | Problema | Arreglo sugerido |
|---|---|---|
| `application/list-station-tickets.service.ts` + `station-ticket-mapper.ts` `STATION_TICKET_INCLUDE` (`GET /kitchen/station-tickets`, 1527 ms local, 10 consultas, 28,8 KB; se llama cada 8 s por cada pantalla de cocina) | `include` de ticket a estación, orden, sesión, mesa completa, ítems, `orderItem` y modificadores = 8 consultas anidadas, y devuelve filas completas de `table`, `tableSession` y `order` que el mapper casi no usa | `relationLoadStrategy: 'join'` y `select` de solo los campos que mapea `mapStationTicket` (reduce también el tamaño); índice parcial de 4.7; considerar un modo `since=<timestamp>` o un `ETag`/`304` para que el polling devuelva vacío cuando no hay cambios |
| `application/update-station-ticket-status.service.ts` | Ruta de escritura de cocina (no medida) sigue el mismo patrón `find` + acceso + transacción | Revisar con el mismo método (viajes secuenciales × RTT) |

### 7.4 Otros módulos que pesan en las 15 más lentas (fuera de menus, reports y kitchen; no modificados)

| Archivo | Problema | Arreglo sugerido |
|---|---|---|
| `orders/application/order-mapper.ts` `ORDER_INCLUDE` (usado por `GET /orders?tableSessionId`, `GET /qr/tables/:qr/orders`, 8 a 9 consultas) | `orderItems` + `preparationStation` + `modifiers` + `stationTickets` + `preparationStation` otra vez: **la estación se consulta 2 veces** (`preparation_stations×2` en el conteo) | Join, y resolver las estaciones una vez (`select` de `id`, `name`, `stationType`) |
| `orders/application/list-qr-session-orders.service.ts` y `payments/application/get-qr-bill.service.ts` / `get-qr-payment-config.service.ts` | Cadena `table` a `tableSession` a `order`/`bill` en serie (3 a 8 viajes) en rutas del comensal que se consultan cada 10 s | Una consulta desde `table` con `include`/join anidado o un `$queryRaw` único; cachear 2 a 5 s por `qrToken` |
| `orders/application/list-branch-ready-summary.service.ts` | `ensureAccess` + `branchSettings` + `orders` en serie (la configuración no depende del acceso), y un GET que auto-entrega pedidos | `Promise.all` entre `branchSettings` y `orders`; mover la auto-entrega a una tarea programada (`@nestjs/schedule` ya está instalado) |
| `analytics/application/get-branch-summary.service.ts` | `ensureAccess` a zona horaria (2 viajes) a 7 consultas paralelas. Se ejecuta `findPaidPaymentsInRange` dos veces (hoy y serie): la de "hoy" está contenida en la de la serie de 7 días | Reutilizar la consulta de la serie para calcular hoy; unir sucursal y zona horaria en una consulta |
| `floor/application/list-tables.service.ts` | `branchSettings` y luego `table.findMany` en serie | `Promise.all` |
| `staff/application/list-staff-users.service.ts` | 5 consultas (3 tras la caché) por el `include` encadenado | Join |
| `restaurants/presentation/http/restaurants.controller.ts` `GET :restaurantId` | Con un id no UUID responde **500** (se vio al llamar con `undefined`); la ruta de detalle cuesta 5 consultas | `ParseUUIDPipe` (400 en vez de 500) y join |

## 8. Cómo repetir las mediciones

1. Compilar a un directorio temporal: `npx tsc -p tsconfig.build.json --outDir %TEMP%\sazono-perf\dist`.
2. Arrancar con las variables de `.env`, `PORT=8081`, `THROTTLE_LIMIT=1000000` y `node -r %TEMP%\sazono-perf\preload.js ...\dist\src\main.js` (`NODE_PATH` apuntando a `node_modules` del backend).
3. `node measure.js http://localhost:8081/api/v1 etiqueta` (con `QLOG=` apuntando al archivo que escribe `preload.js`; `WARM=5` por defecto, `DELAY=500` para Render).
4. `node dbrtt.js` para el RTT y los tiempos de conexión; `node idle.js` para la tolerancia a conexiones ociosas; `node jointest.js` (requiere un cliente generado con `relationJoins`).

## 9. Fuentes consultadas

- Render, regiones: https://render.com/docs/regions y plan gratuito https://render.com/docs/free
- Supabase, regiones (incluye `sa-east-1` São Paulo): https://supabase.com/docs/guides/platform/regions ; modos del pooler y Prisma: https://supabase.com/docs/guides/database/connecting-to-postgres ; cambio de región (crear proyecto nuevo y migrar): https://supabase.com/docs/guides/troubleshooting/change-project-region-eWJo5Z ; réplicas de lectura: https://supabase.com/docs/guides/platform/read-replicas y https://supabase.com/docs/guides/platform/manage-your-usage/read-replicas
- Fly.io, regiones (`gru` São Paulo, sin Santiago): https://docs.fly.io/reference/regions ; Railway (sin Sudamérica): https://docs.railway.com/reference/deployment-regions ; Google Cloud Run (`southamerica-east1` y `southamerica-west1`): https://docs.cloud.google.com/run/docs/locations
- Vercel, regiones de funciones (`gru1`, `pdx1`, `iad1` por defecto; Hobby: una sola región): https://vercel.com/docs/functions/configuring-functions/region y https://vercel.com/docs/regions
- Upstash Redis, precios y regiones: https://upstash.com/pricing/redis
- Región AWS de Chile anunciada: https://aws.amazon.com/blogs/aws/coming-soon-aws-south-america-chile-region/ (fecha de lanzamiento por verificar)
