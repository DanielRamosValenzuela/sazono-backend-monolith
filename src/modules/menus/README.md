# Menus Module

Responsable de estaciones de preparacion, versiones de carta, categorias, items y publicacion por sucursal.

Tambien expone la lectura publica de la carta publicada por `qrToken` en `GET /api/v1/qr/tables/:qrToken/menu`.

`PATCH /categories/:menuCategoryId` y `PATCH /items/:menuItemId` editan (nombre, precio, descripcion, estacion, disponibilidad, orden, o estado de la categoria: activa/oculta/archivada) sobre una carta en `DRAFT`. Mismo guard que `create`: nada de esto se puede tocar una vez publicada la carta.

`PATCH /:menuId/categories/reorder` y `PATCH /categories/:menuCategoryId/items/reorder` reordenan en una sola transaccion (body `{ orderedCategoryIds: [] }` / `{ orderedItemIds: [] }`, arreglo completo, `sortOrder` pasa a ser el indice en el arreglo). Rechazan si el arreglo no coincide exactamente con las categorias/items actuales, o si la carta no esta en `DRAFT`.

`POST /items/:menuItemId/media` (multipart, campo `file`, JPEG/PNG/WEBP hasta 5MB) sube la imagen principal de un item al bucket publico `menu-media` de Supabase Storage (siempre en la misma ruta `menu-items/{menuItemId}/primary`, `upsert: true`, asi que subir una nueva reemplaza la anterior sin dejar objetos huerfanos) y guarda la URL en `MenuItemMedia`. `DELETE /items/:menuItemId/media` la quita. Ambos con el mismo guard `DRAFT`. La carga real al bucket usa la service-role key desde el backend; el navegador nunca ve credenciales de Storage.

`PUT /categories/:menuCategoryId/translations/:locale` y `PUT /items/:menuItemId/translations/:locale` crean o reemplazan la traduccion de nombre (categoria) o nombre/descripcion (item) para ese locale, usando la tabla generica `translations` (`entityType`/`entityId`/`locale`/`fieldName`). Mismo guard `DRAFT`. `GET /menus/:menuId` (lectura staff) devuelve el arreglo `translations` completo por categoria/item para poder editarlas. `GET /qr/tables/:qrToken/menu` (lectura publica) acepta `?locale=` y sustituye nombre/descripcion por la traduccion de ese locale cuando existe, cayendo al idioma original si falta — sin `locale`, o si coincide con `defaultLanguage`, ni siquiera consulta la tabla de traducciones.

`PATCH /preparation-stations/:preparationStationId` edita nombre, `stationType` o `status` (`ACTIVE`/`INACTIVE`) de una estacion existente (solo `ADMIN`). Antes solo se podia crear y listar.

Autorizacion: todo el modulo usa el `BranchAccessService` compartido (`src/common/branch-access`), no un servicio propio del modulo. `GET /menus` y `GET /menus/:id` aceptan `ADMIN` y `WAITER` (lectura, para que el mesero pueda armar una comanda); el resto de endpoints de escritura siguen exclusivos de `ADMIN`.
