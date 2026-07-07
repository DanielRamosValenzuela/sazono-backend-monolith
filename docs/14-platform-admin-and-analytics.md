# Platform Admin CRUD, Branches CRUD y Analytics

## Objetivo

Este slice le da a `platform_admin` visibilidad y control real sobre los restaurantes registrados (mas alla del bootstrap inicial), completa el CRUD de sucursales para `staff`, y agrega lectura agregada (metricas) para los dos dashboards administrativos del frontend.

No agrega tablas nuevas al esquema Prisma. Todo es lectura/agregacion sobre datos existentes mas edicion parcial (`PATCH`) de campos ya modelados.

## Endpoints actuales

### Restaurantes (`platform_admin`)

- `POST /api/v1/restaurants/bootstrap` (ya existia)
- `GET /api/v1/restaurants` — lista todos los restaurantes, con `branchCount`/`staffCount`
- `GET /api/v1/restaurants/platform-metrics` — totales de plataforma, pagos por mes (ultimos 12) y top 5 restaurantes por monto pagado
- `GET /api/v1/restaurants/:restaurantId` — detalle: datos del restaurante, sus `branches` y su `staff` completo (con email resuelto contra Supabase Auth, igual que `GET /staff`)
- `PATCH /api/v1/restaurants/:restaurantId` — edita `name`, `legalName`, `defaultLanguage`, `timezone`, `currency`, `status` (`ACTIVE`/`INACTIVE`)

Orden de rutas importante: `platform-metrics` esta declarada antes que `:restaurantId` en el controller para que no la capture el param dinamico.

### Sucursales (`staff`)

- `POST /api/v1/branches` (ya existia)
- `GET /api/v1/branches` — si el actor es `ADMIN` en alguna sucursal, devuelve todas las del restaurante; si no, solo las sucursales donde tiene algun rol activo
- `PATCH /api/v1/branches/:branchId` — requiere rol `ADMIN` en esa sucursal especifica. Edita `name`, `address`, `status` y hace merge parcial de `branch_settings` (`qrOrderingEnabled`, `qrPaymentMode`, `splitBillEnabled`, `partialDeliveryEnabled`)

### Analytics (`staff`, rol `ADMIN` o `SUPERVISOR` de la sucursal)

- `GET /api/v1/analytics/branches/:branchId/summary` — mesas totales/ocupadas, sesiones abiertas, ventas de hoy (monto y cantidad de pagos `PAID`), ticket promedio, serie de los ultimos 7 dias, ordenes de hoy agrupadas por estado, y top 5 productos de los ultimos 30 dias

## Reglas activas

- `platform_admin` no administra restaurantes distintos del bootstrap salvo por estos endpoints; no hay borrado fisico de restaurantes, solo `status: INACTIVE`
- `PATCH /branches/:branchId` exige `ADMIN` de esa sucursal puntual (no basta ser `ADMIN` de otra sucursal del mismo restaurante)
- `PATCH /staff/:staffUserId` tiene sus propias reglas de proteccion (ver doc 07)
- todos los montos de analytics/metrics son strings numericos con 2 decimales, igual que el resto de la API de dinero

## Alcance actual

- el platform admin puede ver y editar cualquier restaurante, ver su equipo completo con correos, y activarlo/desactivarlo
- un `ADMIN` de restaurante puede ver y editar sus sucursales sin pasar por soporte
- ambos dashboards del frontend (plataforma y restaurante) tienen datos reales que consumir en vez de placeholders

## Lo que falta despues

- listado/gestion de sucursales inactivas o archivadas con filtros
- borrado fisico o purga de restaurantes/sucursales
- metricas de analytics con filtro de rango de fechas custom (hoy son ventanas fijas: hoy, 7 dias, 30 dias)
- monetizacion real de la plataforma: hoy `platform-metrics` agrega pagos comensal→restaurante como proxy de actividad; no existe modelo de suscripcion/cobro de Sazono a los restaurantes
