# Auth and Restaurant Bootstrap

## Decision actual

El backend usa dos piezas separadas:

- Prisma para persistencia del dominio
- Supabase Auth solo para identidad y login externo

La integracion con Supabase Auth no se inyecta directo en los casos de uso. Queda aislada detras del puerto `AUTH_PROVIDER`.

## Detalles de implementacion actuales

- el cliente de Supabase se construye de forma lazy, no durante el bootstrap global de Nest
- si faltan `SUPABASE_URL`, `SUPABASE_ANON_KEY` o `SUPABASE_SERVICE_ROLE_KEY`, la app puede iniciar igual
- los errores de configuracion aparecen cuando realmente se usa un caso de auth que depende de Supabase
- las operaciones admin de auth usan `service_role` y quedan restringidas al backend

## Prisma y conexiones

La configuracion actual sigue el patron recomendado para Supabase con Prisma:

- runtime del backend: `DATABASE_URL` apuntando al pooler
- CLI y migraciones: `DIRECT_URL`

Eso evita mezclar trafico de aplicacion con operaciones de migracion o tooling.

## Por que esta separacion importa

Permite que mas adelante podamos:

- cambiar de provider de auth
- movernos a otro BaaS
- traer auth propia

sin reescribir la logica de negocio de `auth`, `restaurants` o futuros modulos de `staff`.

## Modelo actual de identidad

- `auth.users` guarda la identidad base autenticable
- `platform_admins` representa operadores internos de Sazono
- `staff_users` representa usuarios internos de cada restaurante

Relaciones clave:

- `platform_admins.auth_user_id -> auth.users.id`
- `staff_users.auth_user_id -> auth.users.id`

## Flujo de login actual (con aislamiento por restaurante)

1. el usuario envia email, password, tipo de perfil esperado y, si es `staff`, el `restaurantSlug` de su restaurante a `POST /api/v1/auth/login`
2. el backend autentica contra Supabase Auth
3. si viene `restaurantSlug`, el backend lo resuelve primero a un `restaurantId` (`restaurants.slug` es `@unique`); si el slug no existe, responde 401 generico sin distinguir de una credencial invalida
4. el backend busca el perfil operativo correspondiente, filtrando por ese `restaurantId` si vino resuelto — si la identidad autenticada no tiene un `staff_user` activo en ese restaurante especifico (aunque tenga uno en otro), responde 403
5. se emite JWT propio del backend con el perfil resuelto

Esto es lo que garantiza que las credenciales de un restaurante no sirvan para entrar por la pantalla de otro, incluso si tecnicamente son validas contra Supabase Auth. El detalle de que URL usa cada restaurante para loguearse vive en el frontend (ver doc frontend 11) — el slug es publico y resoluble sin auth via `GET /api/v1/restaurants/by-slug/:slug` (solo devuelve `{name, isActive}`, nada sensible), para poder mostrar el nombre del restaurante antes de autenticar.

`platform_admin` no usa `restaurantSlug` — su identidad ya es un modelo separado (`platform_admins`), sin `restaurantId`.

## Endpoint de bootstrap actual

`POST /api/v1/restaurants/bootstrap`

Este caso de uso hace lo siguiente:

1. exige JWT valido de un `platform_admin`
2. crea la identidad base del primer admin del restaurante en Supabase Auth
3. crea el `restaurant`, generando un `slug` unico a partir del nombre (colisiones se resuelven con sufijo `-2`, `-3`, ...) y guardando `branchQuota` (default 1, o el valor que mande el `platform_admin` segun lo acordado en el onboarding)
4. crea el `staff_user` inicial asociado al restaurante
5. si falla la transaccion de base de datos, elimina la identidad recien creada en Supabase Auth

El `slug` y el `branchQuota` son editables despues via `PATCH /api/v1/restaurants/:id` (solo `platform_admin`).

## Estado transitorio permitido

El primer admin del restaurante nace como `staff_user` activo, pero todavia sin rol por sucursal.

Eso es intencional por el flujo de negocio:

1. Sazono crea restaurante, primer admin y define su cupo de sucursales (`branchQuota`)
2. el restaurante crea sus propias sucursales por autoservicio, hasta el cupo asignado
3. cada sucursal que crea, el creador queda como `ADMIN` de ella

## Cupo de sucursales (`branchQuota`)

`POST /api/v1/branches` sigue siendo autoservicio (lo dispara el propio staff, no `platform_admin`), pero ahora esta acotado:

- se permite si el staff aun no tiene ningun rol por sucursal (primera sucursal), o si ya es `ADMIN` de alguna sucursal del mismo restaurante
- ademas, se valida que `branches.count() < restaurant.branchQuota` — si el restaurante ya alcanzo su cupo, responde 403 con un mensaje claro pidiendo contactar a Sazono para aumentarlo
- no hay flujo de solicitud de aumento automatizado en el MVP: el aumento de cupo es una accion manual de `platform_admin` via `PATCH /restaurants/:id`

Con esto se cierra el estado transitorio del primer admin sin roles por sucursal, sin dejar la creacion de sucursales sin limite.

## Flujo actual de staff interno

Despues de tener al menos una sucursal, un usuario con rol `ADMIN` puede:

1. listar usuarios internos del restaurante
2. crear un nuevo `staff_user` con roles por sucursal
3. reutilizar una identidad base ya existente si el email ya vive en `auth.users`

Esto mantiene la decision original del negocio:

- identidad base compartida
- perfiles operativos separados por restaurante

## Trazas y observabilidad

La base ya esta preparada con OpenTelemetry.

Recomendacion gratuita para desarrollo:

- local: Jaeger o SigNoz levantado con Docker
- exportacion: OTLP HTTP usando `OTEL_EXPORTER_OTLP_ENDPOINT`

La idea es mantener trazas fuera del dominio, como infraestructura intercambiable.
