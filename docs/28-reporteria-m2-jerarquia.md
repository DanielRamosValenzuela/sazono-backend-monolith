# 28. Reportería M2: jerarquía de ventas tipo Toteat

Segundo hito de la especificación de reportería (`docs/11-spec-reporteria-y-reembolsos.md` del repositorio raíz). Agrega categorías anidadas en la carta, un snapshot de categoría en cada línea de pedido y el reporte `sales-by-hierarchy` con drill-down. No incluye reembolsos, impuestos ni descuentos: el monto es el de las líneas vendidas, sin restar nada.

## Qué se construyó

- Migración aditiva `20261119120000_menu_tree_and_category_snapshot` (no aplicada: se despliega con `prisma migrate deploy`).
  - `menu_categories.parent_id` (UUID nullable, autorrelación `CategoryTree`, `ON DELETE RESTRICT`) e índice `(menu_id, parent_id, sort_order)`.
  - `order_items.menu_category_id` (UUID nullable, sin FK dura) y `order_items.category_path_snapshot` (`TEXT[]`, default vacío).
  - Backfill idempotente al final del mismo archivo: toma el nombre de la categoría actual del producto (`menu_items` a `menu_categories`) y, si no se puede resolver (producto borrado), deja `{(Sin categoria)}`. Como las categorías existentes no tienen padre, el path histórico es de un solo nivel. Cada `UPDATE` solo toca filas con `menu_category_id` nulo o path vacío, así que se puede re-ejecutar.
- Carta: `MenuCategory.parentId` opcional al crear y al editar categorías. Reglas: el padre debe ser de la misma carta (y por lo tanto de la misma sucursal), máximo 3 niveles contando el subárbol que se mueve, sin ciclos (ni consigo misma ni bajo un descendiente) y la carta debe estar en DRAFT. `parentId: null` en la edición mueve la categoría a la raíz; omitirlo no la cambia. Los productos pueden vivir en cualquier nivel.
- Creación de pedidos: el resolvedor de productos pedibles (`OrderableMenuItemResolverService`) entrega `menuCategoryId` y `categoryPath` (nombres de raíz a categoría) y los dos únicos caminos que crean `OrderItem` (pedido de mesero/mostrador y pedido por QR) los escriben junto a `nameSnapshot` y `priceSnapshot`. No hay otro camino que cree `OrderItem`.
- Reporte `GET /api/v1/reports/branches/:branchId/sales-by-hierarchy`.

## ¿`priceSnapshot` ya incluye los modificadores?

Sí. El resolvedor guarda `priceSnapshot = menuItem.price + suma(priceDelta de los modificadores elegidos)` por unidad, y la cuenta se cobra con `priceSnapshot * quantity` (`apply-order-charge-to-bill`). Los `OrderItemModifier` son solo el detalle del extra. Por eso el reporte no suma modificadores encima:

- `includeModifiers=true` (por defecto): monto de la línea = `priceSnapshot * quantity`. Es exactamente lo que se cobró.
- `includeModifiers=false`: monto = `(priceSnapshot - suma(priceDeltaSnapshot de la línea)) * quantity`, es decir, solo el precio base.

## Comportamiento de la carta

- `GET /v1/menus/:menuId` y la carta pública por QR siguen devolviendo `categories` como arreglo plano, en el mismo orden y con los mismos campos. Cada categoría suma `parentId` (`string | null`). Las respuestas de crear y editar categoría también suman `parentId`.
- Reordenar categorías sigue siendo una lista plana con todas las categorías de la carta; `sortOrder` es global y el orden relativo entre hermanas se deduce de él.
- Publicar no copia contenido: la carta ya es una versión. Se exige al menos una categoría activa con productos cuyo ancestro también esté activo, así que un padre sin productos propios cuenta si algún descendiente tiene productos.
- La carta pública por QR oculta las subcategorías cuyo padre no está activo (no quedan `parentId` colgando).

## Reglas del reporte

- Prefijo `/api/v1/reports/branches/:branchId/sales-by-hierarchy`. Solo ADMIN y SUPERVISOR; CASHIER, WAITER, KITCHEN y BAR reciben 403.
- `from` y `to` obligatorios (`YYYY-MM-DD`, ambos inclusivos, zona horaria del restaurante), máximo 366 días (92 con `format=csv`), rango semiabierto igual que M1.
- Qué cuenta como venta: líneas de pedidos cuya cuenta tiene al menos un pago PAID. La venta se atribuye al día de `MAX(paid_at)` de los pagos PAID de la cuenta (la misma regla de `sales-by-order`). Se cuentan las líneas no canceladas de pedidos ya cobrados (estados CONFIRMED, ROUTED, IN_PREPARATION, PARTIALLY_READY, READY, DELIVERED); los pedidos QR sin pagar no suman aunque la cuenta tenga otros pagos. Las líneas canceladas no suman monto ni cantidad y salen solo en `cancelledQuantity`.
- La unión entre versiones de carta es por nombre: se agrupa por el path de nombres del snapshot y por el nombre del producto, nunca por ids. Dos versiones con la categoría "Cafe > Bebidas Calientes" se muestran como un solo nodo. Los nombres se comparan exactos (distingue mayúsculas).
- Un nodo de categoría incluye a todos sus descendientes. El drill-down con `parentId` devuelve las subcategorías directas más los productos que están directamente en esa categoría.
- `groupBy=item` agrupa por nombre de producto en una lista plana; `groupBy=station` agrupa por nombre de estación. En ambos casos `parentId` se ignora, `breadcrumb` va vacío y `hasChildren` es false. Las estaciones salen con `kind: "category"`.
- Orden: monto descendente, luego cantidad descendente, luego nombre.
- `share` es el porcentaje del nodo sobre el total de los nodos devueltos en esa misma respuesta (hermanos), con 2 decimales; con total 0 es 0. `totals` es la suma de los nodos de la respuesta: en la raíz es el total del rango; con `parentId` es el total de esa categoría. Invariantes: la suma de los nodos es igual a `totals.amount`, y el total por producto es igual al total por categoría para el mismo filtro.
- Ids de nodo: base64url de `{"k":"c|i|s","p":[...path]}` (c categoría, i producto, s estación). Son estables entre llamadas y entre versiones de carta. El servidor decodifica con validación estricta (solo caracteres base64url, largo máximo, JSON con forma exacta, 1 a 4 segmentos de hasta 200 caracteres); un `parentId` mal formado, de otro tipo o demasiado profundo responde 400. Un `parentId` válido que no existe devuelve `nodes: []`.
- Las líneas históricas sin snapshot (path vacío) se muestran bajo `(Sin categoria)`.
- CSV: UTF-8 con BOM, separador `;`, saltos `\r\n`, cabeceras en español, neutralización de fórmulas (`=`, `+`, `-`, `@`) igual que M1. Exporta la vista actual (los nodos del `parentId` y `groupBy` pedidos) más una fila `TOTAL`. Columnas: Jerarquia (path con ` > `), Tipo (Categoria, Producto o Estacion), Nivel, Monto, Cantidad, Participacion (%) con coma decimal, Anulado, Precio promedio. Archivo `jerarquia-ventas_{branchId}_{from}_{to}.csv`.

## Cuadratura con M1

`sales-by-order` suma pagos (consumo = monto menos propina) y la jerarquía suma líneas. Coinciden para cuentas cobradas completas sin descuentos ni impuesto agregado a la cuenta (hoy `computeBillTotals` no agrega impuesto). Pueden diferir en cuentas parcialmente pagadas dentro del rango (el pago cuenta en M1 pero las líneas de toda la cuenta cuentan en M2) y en líneas de pedidos cancelados después de cobrados.

## Pendiente fuera de M2

Reembolsos y descuentos (la jerarquía no resta nada), parámetro `depth` para devolver el árbol completo en una llamada, editor de árbol en Menu Studio y pestaña Jerarquía en la UI (trabajo del frontend), y filtrar por cajero o medio de pago.

## SQL no ejecutado

La migración y la consulta del reporte no se ejecutaron contra Postgres en este hito; se verificó la forma del SQL con tests unitarios y con `prisma migrate diff` (la parte DDL de la migración coincide con lo que genera Prisma). Antes de desplegar hay que correr `prisma migrate deploy` sobre QA y probar el endpoint con datos reales.
