# Product Context for Backend

## Objetivo del backend

El backend es el responsable de proteger las reglas de negocio criticas del sistema:

- una mesa no puede tener multiples sesiones activas
- una cuenta no puede duplicarse
- QR no puede entrar a produccion sin pago
- el mesero no puede cerrar mesas con deuda
- cocina y barra deben operar tickets separados

## Capacidades principales

### Tenant y sucursal

- restaurantes
- sucursales
- configuracion por sucursal

### Salon

- mesas
- sesiones de mesa
- estados de cierre y abandono

### Carta

- menus por sucursal
- categorias
- items
- traducciones
- asignacion de estacion de preparacion

### Ordenes

- origen QR o mesero
- politica de pago prepaid o postpaid
- estados de orden
- division en tickets por estacion

### Produccion

- cocina
- barra
- entrega parcial

### Cuenta y pagos

- bill unica por sesion
- pagos parciales
- split bill persistente
- manejo de deuda y abandono

### Auth interna

- cuenta de platform admin de Sazono
- usuarios internos
- roles por sucursal
- permisos operativos

Decision tomada:

- misma autenticacion base
- perfiles separados para `platform_admins` y `staff_users`

## Bootstrap SaaS inicial

El backend debe soportar este flujo inicial:

1. un `platform admin` de Sazono crea el restaurante cliente
2. se crea la primera cuenta `admin` del restaurante
3. ese `admin` gestiona sucursales y usuarios internos

Para el MVP no se asume self-signup libre del restaurante final.

## Reglas no negociables para backend

1. Solo una `TableSession` abierta por mesa.
2. Solo una `Bill` activa por `TableSession`.
3. Una orden QR no pasa a produccion sin pago aprobado.
4. Una orden puede separarse en multiples `StationTicket`.
5. Un `waiter` no cierra una mesa con saldo pendiente.
6. Supervisor o caja deben intervenir en abandono o impacto financiero.

## Lo que el backend debe modelar explicitamente

- estados de mesa
- estados de orden
- estados de ticket por estacion
- estados de bill
- estados de payment
- permisos por rol y sucursal

## Casos que merecen cuidado especial

- reintentos de pago QR
- concurrencia en split bill
- doble cierre de mesa
- doble sesion activa por error
- anulaciones luego de produccion o pago
