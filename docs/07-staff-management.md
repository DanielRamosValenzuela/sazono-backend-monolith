# Staff Management

## Objetivo

El modulo `staff` gestiona usuarios internos del restaurante y sus roles activos por sucursal.

## Endpoints actuales

- `GET /api/v1/staff`
- `POST /api/v1/staff`

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

## Lo que falta despues

- editar roles existentes
- desactivar roles por sucursal
- deshabilitar `staff_users`
- invitaciones por email en lugar de password temporal
