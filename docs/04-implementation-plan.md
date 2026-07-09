# Backend Implementation Plan

Este plan traduce el MVP general de Sazono a trabajo concreto del backend.

## 1. Objetivo del backend en el MVP

El backend debe garantizar las reglas criticas del producto y ofrecer contratos estables al frontend.

No es solo un CRUD. Debe proteger estados, permisos y consistencia operativa.

## 2. Responsabilidades del backend en el MVP

- soportar bootstrap SaaS de restaurante y primer admin
- modelar restaurantes, sucursales y mesas
- gestionar usuarios internos y roles por sucursal
- soportar un constructor de carta sin codigo basado en estructura controlada
- publicar la carta por sucursal
- abrir y cerrar `TableSession`
- mantener una sola `Bill` activa por mesa
- crear ordenes QR y de mesero
- dividir ordenes en `StationTicket`
- procesar pagos y reintentos
- soportar split bill simple
- resolver abandono y deuda pendiente

## 3. Modulos prioritarios

### Fase 1

- `staff`
- `branches`
- `floor`
- `menus`

### Fase 2

- `orders`
- `billing`
- `kitchen`

### Fase 3

- `payments`
- permisos finos
- manejo de incidencias

## 4. Entregables del backend MVP

### Fundaciones

- estructura modular lista
- enums y estados de dominio
- esquema SQL inicial
- modulo de autenticacion interna
- flujo de creacion de `Restaurant` y primer `Admin`
- decision de auth compartida con perfiles separados aplicada al esquema

### Core operacional

- `TableSession`
- `Bill`
- `Order`
- `OrderItem`
- `PreparationStation`
- `StationTicket`
- `Payment`

### Core de carta digital

- `Menu`
- `MenuCategory`
- `MenuItem`
- `Translation`
- `MediaAsset`

### Casos de uso minimos

- abrir mesa
- retomar mesa
- cerrar mesa pagada
- crear orden de mesero
- crear orden QR pendiente de pago
- aprobar pago QR y enrutar orden
- generar tickets por estacion
- pagar cuenta abierta
- dividir cuenta simple
- marcar abandono

## 5. Orden recomendado

1. SQL y restricciones principales
2. auth y roles internos
3. mesas, sesiones y cuenta
4. constructor de carta, menu e items
5. ordenes
6. kitchen y station tickets
7. pagos
8. split bill
9. abandono y cierres manuales

## 6. Tareas backend

- [x] Definir SQL inicial para `restaurants`, `branches`, `branch_settings`
- [x] Definir SQL para `platform_admins`
- [x] Definir SQL para `staff_users` y `staff_user_branch_roles`
- [x] Conectar `platform_admins` y `staff_users` a la identidad base compartida
- [x] Definir SQL para `tables` y `table_sessions`
- [x] Definir SQL para `menus`, `menu_categories`, `menu_items`, `translations`
- [x] Definir SQL para assets multimedia de la carta
- [x] Definir SQL para `preparation_stations`
- [ ] Definir SQL para `bills`, `bill_items`, `bill_splits`, `bill_split_participants`
- [ ] Definir SQL para `orders`, `order_items`, `station_tickets`, `station_ticket_items`
- [ ] Definir SQL para `payments` y `payment_attempts`
- [x] Crear modulo de auth interna
- [x] Implementar caso de uso para crear `Restaurant` y primer `Admin`
- [x] Crear modulo `staff` con roles por sucursal
- [x] Crear modulo `floor` con apertura y cierre de mesa
- [x] Crear modulo `menus` con constructor de carta y publicacion
- [x] Implementar ordenamiento de categorias y productos (`sortOrder` + `PATCH .../reorder` en lote; ver doc 10)
- [x] Implementar descripcion e imagen principal por producto (descripcion ya existia; imagen via `MenuItemMedia`/Supabase Storage; ver doc 10)
- [x] Implementar multi idioma basico de carta (tabla `translations`, sustitucion por `?locale=` en la lectura publica; ver doc 10)
- [x] Crear modulo `orders` con origen QR y mesero
- [x] Crear modulo `kitchen` con tickets por estacion
- [x] Crear modulo `billing` con cuenta unica por mesa
- [x] Crear modulo `payments` con prepago QR
- [x] Implementar validacion de una sola `TableSession` activa por mesa
- [x] Implementar validacion de una sola `Bill` activa por sesion
- [x] Implementar regla QR no entra a produccion sin pago aprobado
- [x] Implementar cierre manual de mesa
- [x] Implementar resolucion de deuda o abandono por supervisor o caja
- [x] Implementar listado y detalle de restaurantes para `platform_admin` (con sucursales y staff con email)
- [x] Implementar edicion de restaurante y activar/desactivar (`platform_admin`)
- [x] Implementar metricas agregadas de plataforma (`platform-metrics`)
- [x] Implementar listado y edicion de sucursales para `staff` (`GET`/`PATCH /branches`)
- [x] Implementar edicion de staff existente (`PATCH /staff/:id`) con reglas de proteccion de ultimo `ADMIN`
- [x] Implementar modulo `analytics` con resumen por sucursal para el dashboard del restaurante

## 7. Estado actual

- existe una migracion inicial Prisma en `prisma/migrations/20260703101000_init_foundation`
- auth ya funciona con perfil resuelto sobre `platform_admins` y `staff_users`
- el bootstrap SaaS crea restaurante y primer admin mediante Supabase Auth + Prisma
- ya existe creacion de sucursal con asignacion automatica de rol `ADMIN` al creador
- ya existe alta y listado de `staff_users` con roles activos por sucursal
- `floor` ya soporta mesas, apertura manual de `TableSession`, retoma y cierre manual
- abrir una `TableSession` ahora crea su `Bill` operativa en el mismo flujo
- `billing` ya expone lectura de la cuenta activa por `TableSession`
- `menus` ya soporta estaciones de preparacion, versiones draft, categorias, items y publicacion por sucursal
- `menus` ya expone lectura publica de la carta publicada por `qrToken`
- `orders` ya soporta orden pospago de mesero (snapshot de precio, cargo a la `Bill` y ruteo a estaciones) y orden prepago QR en `AWAITING_PAYMENT`
- `kitchen` ya lista tickets por estacion y avanza sus estados sincronizando items y orden
- la politica de impuestos vive aislada en `billing/domain/tax-policy.ts` (precios con IVA incluido)
- `payments` ya aprueba el prepago QR (cargo + ruteo en la misma transaccion), paga cuenta abierta desde QR y desde caja, con propina, pagos parciales y reintento ante fallo
- el proveedor de pago esta aislado tras el puerto `PAYMENT_PROVIDER` con un adapter manual; la pasarela real sera un nuevo adapter
- al saldar la cuenta la sesion pasa a `PAYMENT_COMPLETED`; el cierre de mesa sigue siendo manual
- split bill simple (`BY_AMOUNT`) dentro de la misma cuenta, con pago por participante via token QR
- entrega de ordenes (`DELIVERED`), cancelacion antes/durante produccion y abandono de mesa por caja/supervisor
- el backend MVP operacional esta completo; pendiente menor: pasarela de pago real (multimedia de carta y multi idioma ya se resolvieron, ver doc 10)
- `restaurants` ahora expone CRUD de lectura/edicion para `platform_admin` (listar, detalle con equipo, editar, activar/desactivar) y metricas agregadas de plataforma
- `branches` ahora expone listado y edicion (`PATCH`) para `staff`, incluyendo merge parcial de `branch_settings`
- `staff` ahora expone edicion (`PATCH /staff/:id`) con reglas de proteccion: no auto-desactivarse, no dejar el restaurante sin `ADMIN`
- nuevo modulo `analytics` con `GET /analytics/branches/:id/summary` (mesas, ventas de hoy, serie 7 dias, ordenes por estado, top productos) para el dashboard del restaurante
- ver doc 14 para el detalle de este slice

## 8. Definition of Done backend MVP

El backend MVP esta listo cuando:

1. expone contratos consistentes para QR y staff
2. soporta cartas por restaurante y sucursal sin requerir programacion
3. protege las reglas de sesion, cuenta, orden y pago
4. puede enrutar tickets por estacion
5. permite cobro total o parcial
6. soporta cierre manual y abandono
