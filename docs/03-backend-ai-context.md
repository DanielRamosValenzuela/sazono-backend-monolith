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

1. construir `menus` para que exista una fuente oficial de items y precios
2. despues abrir `orders` para conectar `TableSession` + `Bill` + `MenuItem`
3. luego levantar `kitchen` con `StationTicket`
4. dejar `payments`, split bill e incidencias operativas para la siguiente iteracion
