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
- [ ] Implementar ordenamiento de categorias y productos
- [ ] Implementar descripcion e imagen principal por producto
- [ ] Implementar multi idioma basico de carta
- [x] Crear modulo `orders` con origen QR y mesero
- [x] Crear modulo `kitchen` con tickets por estacion
- [x] Crear modulo `billing` con cuenta unica por mesa
- [ ] Crear modulo `payments` con prepago QR
- [x] Implementar validacion de una sola `TableSession` activa por mesa
- [x] Implementar validacion de una sola `Bill` activa por sesion
- [x] Implementar regla QR no entra a produccion sin pago aprobado (la orden QR queda `AWAITING_PAYMENT` sin tickets ni cargos; falta el caso de uso de aprobacion en `payments`)
- [x] Implementar cierre manual de mesa
- [ ] Implementar resolucion de deuda o abandono por supervisor o caja

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
- el siguiente bloque natural de trabajo es `payments`: aprobar pago QR, pagar cuenta abierta y split bill

## 8. Definition of Done backend MVP

El backend MVP esta listo cuando:

1. expone contratos consistentes para QR y staff
2. soporta cartas por restaurante y sucursal sin requerir programacion
3. protege las reglas de sesion, cuenta, orden y pago
4. puede enrutar tickets por estacion
5. permite cobro total o parcial
6. soporta cierre manual y abandono
