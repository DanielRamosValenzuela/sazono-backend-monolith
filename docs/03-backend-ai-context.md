# Backend AI Context

## Lo que una IA debe entender antes de tocar este proyecto

Este backend no es un CRUD simple. Tiene reglas de concurrencia, autorizacion y transicion de estados que son parte del producto.

## Invariantes clave

- una sola sesion activa por mesa
- una sola cuenta activa por sesion
- QR requiere pago antes de produccion
- mesero puede generar orden postpago
- cocina y barra operan tickets separados
- la mesa se cierra manualmente

## Modulos que probablemente apareceran primero

1. `floor`
2. `menus`
3. `orders`
4. `billing`
5. `payments`
6. `staff`

## Lo que la IA debe evitar

- implementar reglas de negocio solo a nivel de controller
- saltarse validaciones porque "el frontend ya lo controla"
- asumir que una orden es igual a una cuenta
- asumir que cocina y barra comparten el mismo ticket
- cerrar automaticamente una mesa cuando el saldo llega a cero

## Integraciones que merecen puertos o adapters

- payment provider
- media storage
- email or notifications
- auth provider externo
- exportador de trazas

## Estado actual del repo

- el esquema Prisma base ya modela el dominio principal del MVP
- `platform_admins` y `staff_users` usan `auth_user_id` enlazado a `auth.users`
- la autenticacion externa actual es Supabase Auth, aislada por puerto
- ya existe un endpoint de bootstrap para crear restaurante y primer admin
- ya existe un endpoint para crear la primera sucursal y autoasignar rol `ADMIN`
- ya existen endpoints para listar y crear usuarios internos con roles por sucursal
- `floor` ya cubre mesas, apertura de sesion, retoma y cierre manual
- `billing` ya expone la cuenta operativa actual por `TableSession`
- `menus` ya cubre estaciones de preparacion, versiones draft, categorias, items y publicacion por sucursal
- `menus` expone lectura publica de carta por `qrToken` bajo `/api/v1/qr`
- `orders` ya crea ordenes pospago de mesero (cargo a la cuenta + tickets) y ordenes prepago QR en `AWAITING_PAYMENT`
- `kitchen` ya opera tickets por estacion con transiciones validadas y recomputo del estado de la orden
- la politica de impuestos esta aislada en `billing/domain/tax-policy.ts`: los precios ya incluyen IVA
- `payments` ya cubre prepago QR con reintento, pago de cuenta abierta (QR y caja), propina y pagos parciales
- el proveedor de pago vive tras el puerto `PAYMENT_PROVIDER`; el MVP usa un adapter manual que aprueba de inmediato
- split bill, entrega, cancelacion de ordenes y abandono de mesa ya estan implementados
- `platform_admin` ya puede listar, ver el detalle (con `branches` y `staff` con email resuelto) y editar cualquier restaurante, ademas de ver metricas agregadas de plataforma (ver doc 14)
- `staff` ya puede listar y editar sucursales (`GET`/`PATCH /branches`), y editar staff existente (`PATCH /staff/:id`) con reglas de proteccion contra auto-desactivarse o dejar el restaurante sin `ADMIN`
- existe un modulo `analytics` con `GET /analytics/branches/:id/summary` para el dashboard del restaurante (ver doc 14)
- la autorizacion por sucursal vive en un `BranchAccessService` unico y global (`src/common/branch-access`), no en copias por modulo (ver doc 15)
- `restaurants` tiene `slug` (login exclusivo por restaurante, ver doc 05) y `branchQuota` (limite de sucursales autoservicio, ver doc 15)
- existe un modulo `leads` (`POST /leads` publico con throttle estricto, `GET /leads` platform_admin) para el formulario de contacto/demo de la landing; `restaurants` expone ademas `GET /restaurants/search?q=` publico para que un cliente encuentre su URL de login (ver doc 16)

## Versionado HTTP actual

Los endpoints de negocio viven bajo `/api/v1`.

Si agregas nuevos endpoints, manten ese contrato salvo que exista una razon concreta para abrir `v2`.

## Matiz importante del modelo actual

El primer admin del restaurante se crea como `staff_user` del restaurante, pero todavia no recibe rol por sucursal porque las sucursales se crean despues.

Eso implica un estado transitorio valido:

- `staff_user` activo
- asociado a `restaurant`
- sin filas en `staff_user_branch_roles` hasta crear la primera sucursal

## Siguiente paso sugerido para este repo

1. adapter de pasarela de pago real cuando se elija el proveedor (Webpay, MercadoPago, Stripe, etc.)
2. reembolsos y anulaciones con impacto financiero en ordenes prepagadas
3. modelo de monetizacion de la plataforma (suscripcion o cobro de Sazono a los restaurantes); hoy no existe

Evaluado y diferido a proposito (ver doc 15):

- aislamiento granular por estacion de cocina (hoy cualquier staff `KITCHEN`/`BAR` de la sucursal ve todas las estaciones, no solo la suya) — no es fuga entre tenants, se resuelve primero a nivel de UI si hace falta antes de invertir en una migracion de schema nueva

Ya resuelto (ver doc frontend 09):

- actualizar (y archivar) categorias/items existentes de la carta (`PATCH /menus/categories/:id`, `PATCH /menus/items/:id`, ver doc 10)
- filtro de rango de fechas custom en analytics (ver doc 14)

Ya resuelto (ver doc frontend 10):

- multimedia e imagen principal por producto en la carta
- multi idioma basico de carta
- ordenamiento fino de categorias e items con drag-and-drop

Ya resuelto (ver doc frontend 11 y doc backend 15):

- control de acceso por sucursal consolidado (`BranchAccessService`), cupo de sucursales y login exclusivo por restaurante
- permisos de `WAITER` corregidos (lectura de menu habilitada, exceso de permisos removido)
- CRUD completo de estaciones de preparacion

Ya resuelto (ver doc frontend 12 y doc backend 16):

- landing marketera con formulario real de contacto/demo (modulo `leads`)
- busqueda publica de restaurantes para la pantalla "ya soy cliente"
