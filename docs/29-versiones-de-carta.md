# 29. Versiones de carta: duplicar, renombrar y eliminar

El dueño puede mantener muchas versiones de carta por sucursal (DRAFT, PUBLISHED, ARCHIVED). Para cambiar un precio de una carta publicada ya no hay que armar todo de nuevo: se duplica la carta a un DRAFT, se edita y se publica. Los tres endpoints son solo para `ADMIN` de la sucursal de la carta.

## Endpoints

- `POST /api/v1/menus/:menuId/duplicate`, body opcional `{ "name": "..." }`. Funciona desde cualquier estado. Responde 201 con el mismo cuerpo que `GET /api/v1/menus/:menuId` (`MenuDetailResponseDto`) de la carta nueva.
- `PATCH /api/v1/menus/:menuId`, body `{ "name": "..." }` (1 a 120 caracteres). Renombra una carta en cualquier estado. Responde 200 con el resumen de la carta (`MenuListItemResponseDto`).
- `DELETE /api/v1/menus/:menuId`. Responde 204. Solo cartas en DRAFT; una carta PUBLISHED o ARCHIVED responde 409 con un mensaje en español.

Una carta inexistente responde 400, igual que el resto del módulo. Sin rol ADMIN en la sucursal responde 403.

## Qué copia el duplicado

La carta nueva queda en DRAFT, con la siguiente versión de la sucursal (última versión + 1), el mismo `defaultLanguage` y el nombre indicado. Si no se indica nombre, usa `<nombre original> (copia)`, recortando el original para no pasar de 120 caracteres. No hay restricción de nombre único en la sucursal (la unicidad es por sucursal y versión), así que un nombre repetido es válido.

Copia, con ids nuevos:

- Categorías con su jerarquía (`parentId` remapeado a las categorías nuevas), `sortOrder`, estado y nombre.
- Items: nombre, descripción, precio, sku, tipo, disponibilidad, orden y estación de preparación.
- Vínculos item a grupo de modificadores, con su orden. Los grupos de modificadores son de la sucursal y se comparten, no se clonan.
- Imágenes de los items: se crean filas nuevas apuntando a la misma URL. No se copian objetos en el storage.
- Traducciones de categorías e items.

La carta original no se toca. Todo ocurre en una sola transacción, con un `createMany` por tabla (categorías, items, imágenes, vínculos de modificadores y traducciones), así que el costo no crece con la cantidad de filas. Las categorías se insertan en un único `INSERT` multi-fila; Postgres valida la llave foránea de `parentId` al final de la sentencia, por eso el padre y el hijo pueden ir en el mismo lote.

Una consecuencia de compartir imágenes: la imagen de un item se guarda siempre en la ruta `menu-items/{menuItemId}/primary`. Si en la copia se sube una imagen nueva, el item copiado usa su propio id y por lo tanto su propia ruta, así que no pisa la del original. Quitar la imagen en la copia solo borra la fila de la copia.

## Eliminar

Solo se elimina una carta en DRAFT. Una carta PUBLISHED (o la carta por defecto) nunca se elimina: la sucursal necesita una carta activa. Las ARCHIVED tampoco se eliminan aunque ninguna llave foránea lo bloquee (los pedidos guardan snapshot y `order_items.menu_item_id` es `ON DELETE SET NULL`), porque conservar el historial de versiones es más seguro que perderlo. Si más adelante se quiere permitir, basta relajar la condición de estado en `DeleteMenuService`.

La eliminación borra, en una transacción, las traducciones de las categorías e items, luego las categorías de la más profunda a la raíz (la autorrelación `parentId` es `ON DELETE RESTRICT`, así que no se puede borrar un padre antes que sus hijos) y al final la carta. Los items, imágenes y vínculos de modificadores caen por `ON DELETE CASCADE` al borrar sus categorías.

## Flujo recomendado para cambiar un precio

1. `POST /menus/:menuId/duplicate` sobre la carta publicada.
2. `PATCH /menus/items/:menuItemId` en la copia con el precio nuevo.
3. `POST /menus/:newMenuId/publish`: la copia pasa a ser la carta activa y la anterior queda ARCHIVED.
4. Si la copia ya no sirve, `DELETE /menus/:newMenuId` mientras siga en DRAFT.
