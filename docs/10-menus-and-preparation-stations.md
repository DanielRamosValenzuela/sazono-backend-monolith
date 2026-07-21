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
- `PATCH /api/v1/menus/preparation-stations/:preparationStationId` — edita `name`, `stationType` o `status` (`ACTIVE`/`INACTIVE`)
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
- `POST /api/v1/menus/modifier-groups`
- `GET /api/v1/menus/modifier-groups?branchId=`
- `PATCH /api/v1/menus/modifier-groups/:modifierGroupId`
- `POST /api/v1/menus/modifier-groups/:modifierGroupId/options`
- `PATCH /api/v1/menus/modifier-options/:modifierOptionId`
- `PUT /api/v1/menus/items/:menuItemId/modifier-groups` — reemplaza de una vez el conjunto completo de grupos de modificadores asignados a un item (delete+recreate en transaccion)

## Modificadores de producto

Sub-dominio nuevo dentro de `src/modules/menus` (`src/modules/menus/application/*modifier*`). Sigue el patron de Square/Toast en vez de modelar el modificador como un campo del item: el item base se conecta a uno o mas **grupos** de modificadores reutilizables, y cada grupo tiene sus propias **opciones**.

Modelo de datos (4 tablas nuevas):

- `modifier_groups` — `branchId`, `name`, `selectionType` (`ONE`/`MANY`, enum `ModifierSelectionType`), `minSelect`, `maxSelect`, `isRequired`, `sortOrder`. Los grupos estan anclados a la sucursal, no a un producto: un grupo como "Termino de coccion" se crea una vez y se reutiliza en varios items.
- `modifier_options` — `modifierGroupId`, `name`, `priceDelta` (`DECIMAL(12,2)`, puede ser 0 o negativo), `isAvailable`, `sortOrder`.
- `menu_item_modifier_groups` — tabla puente N:N entre `menu_item` y `modifier_group`, con `sortOrder` propio para el orden de despliegue en el item.
- `order_item_modifiers` — snapshot al momento de ordenar: `orderItemId`, `modifierOptionId` (nullable, sobrevive si la opcion se borra despues), `nameSnapshot`, `priceDeltaSnapshot`.

Todos los servicios de escritura (`create-modifier-group`, `update-modifier-group`, `create-modifier-option`, `update-modifier-option`, `set-menu-item-modifier-groups`) exigen `ensureAccess(..., [Role.ADMIN])`, igual que el resto de la administracion de carta. `list-modifier-groups.service.ts` es de lectura.

`menu-mapper.ts` expone `mapModifierGroup`, `mapModifierOption` y `mapMenuItemModifierGroups`. `MenuItemResponseDto` y `MenuItemSummaryResponseDto` ahora incluyen `modifierGroups: ModifierGroupResponseDto[]` — todo query que devuelve detalle de item (`get-menu-detail`, `get-published-menu-by-qr`, `publish-menu`, `update-menu-item`, subir/quitar imagen) incluye la relacion correspondiente.

El consumo en el flujo de ordenes (calculo de precio, validacion de min/max/required, snapshot en `OrderItemModifier`) esta documentado en doc 11.

## Reglas activas

- solo un `ADMIN` de sucursal puede administrar (crear/editar/publicar) la carta
- `GET /menus` y `GET /menus/:id` tambien aceptan rol `WAITER` (solo lectura, sin esto el mesero no puede cargar el menu para armar una comanda; ver doc 15)
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
