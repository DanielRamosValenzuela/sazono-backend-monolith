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
- `POST /api/v1/menus/categories/:menuCategoryId/items`
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

- multimedia en productos
- traducciones y fallback por idioma
- actualizacion y archivado fino de categorias o items

Ya resuelto en el slice de orders y kitchen (ver doc 11):

- lectura publica de carta por QR (`GET /api/v1/qr/tables/:qrToken/menu`)
- integracion con `orders` para snapshot de nombre y precio
