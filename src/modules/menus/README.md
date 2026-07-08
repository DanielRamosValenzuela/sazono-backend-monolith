# Menus Module

Responsable de estaciones de preparacion, versiones de carta, categorias, items y publicacion por sucursal.

Tambien expone la lectura publica de la carta publicada por `qrToken` en `GET /api/v1/qr/tables/:qrToken/menu`.

`PATCH /categories/:menuCategoryId` y `PATCH /items/:menuItemId` editan (nombre, precio, descripcion, estacion, disponibilidad, orden, o estado de la categoria: activa/oculta/archivada) sobre una carta en `DRAFT`. Mismo guard que `create`: nada de esto se puede tocar una vez publicada la carta.
