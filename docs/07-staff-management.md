# Staff Management

## Objetivo

El modulo `staff` gestiona usuarios internos del restaurante y sus roles activos por sucursal.

## Endpoints actuales

- `GET /api/v1/staff`
- `POST /api/v1/staff`
- `PATCH /api/v1/staff/:staffUserId`

## Version actual

El contrato publico actual de staff sale en `v1`.

## Regla de acceso actual

Solo un usuario `staff` autenticado con al menos un rol `ADMIN` activo puede usar estos endpoints.

Ademas, solo puede asignar roles sobre sucursales donde el mismo sea `ADMIN`.

## Flujo de creacion de staff

1. el actor autenticado entra como `staff`
2. el backend valida que tenga rol `ADMIN` en las sucursales objetivo
3. si el email ya existe en `auth.users`, se reutiliza esa identidad base
4. si el email no existe, se crea una nueva identidad base en Supabase Auth
5. se crea `staff_user`
6. se crean roles activos en `staff_user_branch_roles`

## Alcance actual

El slice actual resuelve:

- alta de staff interno
- vinculacion con identidad base compartida
- asignacion inicial de roles por sucursal
- listado de staff con roles activos
- edicion de `firstName`/`lastName`, activar/desactivar (`status`) y reemplazo completo del set de roles por sucursal

## Flujo de edicion de staff (`PATCH /api/v1/staff/:staffUserId`)

1. el actor autenticado entra como `staff` con rol `ADMIN` en al menos una sucursal del restaurante
2. `staff_user_id` objetivo debe pertenecer al mismo restaurante del actor (404 si no)
3. si `branchRoles` viene en el body, reemplaza el set completo: los roles actuales pasan a `INACTIVE` y se hace `upsert` de los nuevos a `ACTIVE` (respeta el unique `staffUserId, branchId, role`, sin hard-deletes)
4. el actor no puede desactivarse a si mismo (`status: DISABLED` sobre su propio `staffUserId`) ni dejarse sin ningun rol `ADMIN`
5. la operacion se rechaza (409) si dejaria al restaurante sin ningun `staff_user` `ACTIVE` con rol `ADMIN` activo
6. solo puede asignar roles en sucursales donde el mismo actor es `ADMIN` (mismo criterio que el alta)

## Lo que falta despues

- invitaciones por email en lugar de password temporal
- borrado fisico de `staff_users` (hoy solo existe desactivacion via `status`)
