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

## Siguiente paso sugerido para este repo

1. definir estructura modular en `src/modules`
2. crear enums centrales de estados
3. diseñar entidades y casos de uso de `floor`, `orders`, `billing` y `payments`
4. recien despues bajar a SQL o ORM bindings
