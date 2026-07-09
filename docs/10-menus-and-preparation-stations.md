# Menus and Preparation Stations

## Objetivo

Este slice deja la primera base real de carta digital para el MVP:

- estaciones de preparacion por sucursal
- versiones de carta en `DRAFT`
- categorias
- items con precio y estacion por defecto
- publicacion de una carta activa por sucursal

## Endpoints actuales

- `POST /api/v1/menus/preparation-stations`
- `GET /api/v1/menus/preparation-stations`
- `POST /api/v1/menus`
- `GET /api/v1/menus`
- `GET /api/v1/menus/:menuId`
- `POST /api/v1/menus/:menuId/categories`
- `PATCH /api/v1/menus/categories/:menuCategoryId` — edita `name`, `sortOrder` o `status` (`ACTIVE`/`HIDDEN`/`ARCHIVED`)
- `PATCH /api/v1/menus/:menuId/categories/reorder` — reordena todas las categorias de la carta en una transaccion (body `{ orderedCategoryIds: [] }`, arreglo completo)
- `POST /api/v1/menus/categories/:menuCategoryId/items`
- `PATCH /api/v1/menus/items/:menuItemId` — edita cualquier campo editable de `CreateMenuItemDto` (nombre, descripcion, precio, sku, tipo, estacion, disponibilidad, `sortOrder`)
- `PATCH /api/v1/menus/categories/:menuCategoryId/items/reorder` — reordena todos los items de la categoria en una transaccion (body `{ orderedItemIds: [] }`, arreglo completo)
- `POST /api/v1/menus/items/:menuItemId/media` — multipart (`file`), sube/reemplaza la imagen principal del item en el bucket publico `menu-media` de Supabase Storage
- `DELETE /api/v1/menus/items/:menuItemId/media` — quita la imagen principal
- `PUT /api/v1/menus/categories/:menuCategoryId/translations/:locale` — crea o reemplaza la traduccion de `name` de la categoria para ese locale
- `PUT /api/v1/menus/items/:menuItemId/translations/:locale` — crea o reemplaza la traduccion de `name`/`description` del item para ese locale
- `POST /api/v1/menus/:menuId/publish`

## Reglas activas

- solo un `ADMIN` de sucursal puede administrar la carta
- cada `menu_item` debe apuntar a una `PreparationStation` activa de la misma sucursal
- una carta `PUBLISHED` no se edita; los cambios deben ocurrir sobre una nueva version `DRAFT`
- publicar una carta la deja como `defaultMenuId` de la sucursal
- al publicar una nueva carta, la anterior `PUBLISHED` pasa a `ARCHIVED`
- para publicarse, la carta debe tener al menos una categoria `ACTIVE` con items

## Alcance actual

Este slice ya permite:

- crear estaciones de cocina o barra
- crear una nueva version de carta
- cargar categorias e items con precio
- consultar el detalle estructurado de la carta
- publicar una version lista para consumo futuro por QR y staff

## Lo que falta despues

- fallback de idioma mas alla de es/en si se agregan mas locales
- galeria de multiples imagenes por item (hoy es una sola, "imagen principal")

Ya resuelto en el slice de orders y kitchen (ver doc 11):

- lectura publica de carta por QR (`GET /api/v1/qr/tables/:qrToken/menu`)
- integracion con `orders` para snapshot de nombre y precio

Ya resuelto en el slice de huecos incrementales (ver doc frontend 09):

- edicion y archivado de categorias e items existentes, con el mismo guard
  "solo `DRAFT`" que ya aplicaba a create

Ya resuelto en el slice de fase 5 / paquete de carta (ver doc frontend 10):

- `sortOrder` en items (antes solo las categorias lo tenian) y
  reordenamiento en lote para categorias e items
- imagen principal por producto (`MenuItemMedia`, bucket `menu-media`)
- traducciones de nombre/descripcion por locale (`Translation`), con
  sustitucion automatica en la lectura publica via `?locale=`
