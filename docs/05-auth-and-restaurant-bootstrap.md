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

## Flujo de login actual

1. el usuario envia email, password y tipo de perfil esperado a `POST /api/v1/auth/login`
2. el backend autentica contra Supabase Auth
3. el backend busca el perfil operativo correspondiente
4. se emite JWT propio del backend con el perfil resuelto

## Endpoint de bootstrap actual

`POST /api/v1/restaurants/bootstrap`

Este caso de uso hace lo siguiente:

1. exige JWT valido de un `platform_admin`
2. crea la identidad base del primer admin del restaurante en Supabase Auth
3. crea el `restaurant`
4. crea el `staff_user` inicial asociado al restaurante
5. si falla la transaccion de base de datos, elimina la identidad recien creada en Supabase Auth

## Estado transitorio permitido

El primer admin del restaurante nace como `staff_user` activo, pero todavia sin rol por sucursal.

Eso es intencional por el flujo de negocio:

1. Sazono crea restaurante y primer admin
2. el restaurante crea su primera sucursal
3. recien ahi se asigna el rol `ADMIN` sobre una `branch`

## Siguiente paso recomendado

El flujo inmediato que sigue al bootstrap ahora queda asi:

1. el primer admin hace `POST /api/v1/branches`
2. se crea la sucursal
3. se inicializa `branch_settings`
4. el creador queda con rol `ADMIN` en esa branch

Con eso se cierra el estado transitorio del primer admin sin roles por sucursal.

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
