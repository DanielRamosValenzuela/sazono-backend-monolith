# Modificadores, Cocina Expedita y Notificaciones

## Objetivo

El dueno del producto reviso la app viva (flujo de mesero y cocina) y dejo 10 observaciones de UX. Cada una se investigo contra el codigo real, se diseno un plan de 7 piezas de trabajo (A-G) y se implemento. Este doc consolida el cierre de esa ronda desde el lado del backend: que se construyo, los endpoints nuevos, el modelo de datos nuevo, y los riesgos de la migracion de enum por si hay que repetir un patron similar.

No todas las piezas del plan A-G tocaron backend; este doc cubre las que si (A, B, D, F). Ver doc frontend correspondiente para las piezas de solo-UI.

## A. Modificadores de producto

Sub-dominio nuevo dentro de `src/modules/menus`. Documentado en detalle en doc 10 (seccion "Modificadores de producto"); resumen tecnico aqui.

### Modelo de datos

4 tablas Prisma nuevas:

- `modifier_groups` — `branchId`, `name`, `selectionType` (enum `ModifierSelectionType`: `ONE`/`MANY`), `minSelect`, `maxSelect`, `isRequired`, `sortOrder`
- `modifier_options` — `modifierGroupId`, `name`, `priceDelta` (`DECIMAL(12,2)`), `isAvailable`, `sortOrder`
- `menu_item_modifier_groups` — tabla puente N:N producto <-> grupo, con `sortOrder` propio
- `order_item_modifiers` — snapshot: `orderItemId`, `modifierOptionId` (nullable), `nameSnapshot`, `priceDeltaSnapshot`

Patron: los grupos son reutilizables entre productos porque estan anclados a `branchId`, no a un `menuItemId` individual (patron Square/Toast). Un item se arma como: item base -> N grupos de modificadores adjuntos -> cada grupo con sus opciones y su propio `priceDelta`. `selectionType`/`minSelect`/`maxSelect`/`isRequired` es lo que en Square/Toast seria "single vs. multi select, opcional vs. obligatorio".

### Servicios y endpoints

Servicios nuevos en `src/modules/menus/application/`: `create-modifier-group.service.ts`, `update-modifier-group.service.ts`, `list-modifier-groups.service.ts`, `create-modifier-option.service.ts`, `update-modifier-option.service.ts`, `set-menu-item-modifier-groups.service.ts` (attach/replace del conjunto de grupos de un item, patron delete+recreate en una sola transaccion). Todos los de escritura exigen `ensureAccess(..., [Role.ADMIN])`.

Endpoints (`menus.controller.ts`):

- `POST /api/v1/menus/modifier-groups`
- `GET /api/v1/menus/modifier-groups?branchId=`
- `PATCH /api/v1/menus/modifier-groups/:modifierGroupId`
- `POST /api/v1/menus/modifier-groups/:modifierGroupId/options`
- `PATCH /api/v1/menus/modifier-options/:modifierOptionId`
- `PUT /api/v1/menus/items/:menuItemId/modifier-groups`

`menu-mapper.ts` gano `mapModifierGroup`, `mapModifierOption`, `mapMenuItemModifierGroups`. `MenuItemResponseDto`/`MenuItemSummaryResponseDto` incluyen `modifierGroups: ModifierGroupResponseDto[]`; todos los queries que devuelven detalle de item (`get-menu-detail`, `get-published-menu-by-qr`, `publish-menu`, `update-menu-item`, subir/quitar imagen) se extendieron con el include correspondiente.

### Integracion con el flujo de ordenes

`CreateOrderItemDto` (`orders.dto.ts`) gano `modifierOptionIds?: string[]`, opcional. `orderable-menu-item-resolver.service.ts` — compartido por `create-waiter-order.service.ts` y `create-qr-order.service.ts` — valida la seleccion contra cada grupo adjunto al item (min/max/required) y calcula el precio final (`OrderableMenuItem.price` = precio base + suma de `priceDelta` seleccionados). El resto del flujo de cobro solo consume `item.price`, asi que no necesito cambios.

Se crean filas `OrderItemModifier` (snapshot de `name`/`priceDelta`) en la misma transaccion que crea el `OrderItem`. `create-qr-order.service.ts` paso de `orderItem.createMany` a un loop de `orderItem.create` individuales — necesario para poder anidar la creacion de modificadores por item dentro de la misma llamada. `order-mapper.ts`/`OrderItemResponseDto` incluyen `modifiers: OrderItemModifierResponseDto[]`.

Contrato de no-regresion verificado con test: sin `modifierOptionIds`, el `priceSnapshot` resultante es identico al de antes del cambio.

## B. Se elimino `ACCEPTED` de `StationTicketStatus`

### Motivo

`ACCEPTED` no media nada de negocio real: `StationTicket` solo tiene timestamps `sentAt`/`startedAt`/`completedAt` (ninguno propio para "aceptado"), y `computeOrderStatusFromTickets` ya lo trataba exactamente igual que `PENDING` — confirmado por el test unitario existente antes de tocar nada.

`StationTicketStatus` ahora es: `PENDING | IN_PROGRESS | READY | CANCELLED`.

### Migracion y riesgos (referencia para repetir el patron)

Postgres no soporta `ALTER TYPE ... DROP VALUE`, asi que quitar un valor de un enum requiere reconstruir el tipo:

1. paso de seguridad de datos primero: `UPDATE station_tickets SET status = 'PENDING' WHERE status = 'ACCEPTED'` (no habia filas reales en ese estado en produccion, pero el paso se dejo igual — es barato y evita que la migracion falle si algun ambiente si tenia filas en ese estado)
2. crear un tipo enum nuevo con solo los 4 valores restantes
3. `ALTER TABLE station_tickets ALTER COLUMN status TYPE <tipo_nuevo> USING status::text::<tipo_nuevo>`
4. `DROP TYPE` del enum viejo y `RENAME` del nuevo al nombre original

Riesgo principal de este patron: si el `UPDATE` de seguridad se omite y existen filas en el valor que se esta eliminando, el paso 3 falla porque el cast `USING` no tiene a donde mapear ese valor. Siempre correr el `UPDATE` de reasignacion antes del swap de tipo, aunque se crea que no hay filas afectadas.

### Limpieza de codigo muerto

`src/modules/kitchen/domain/station-ticket-transitions.ts` actualizado: `ACCEPTED` ya no aparece como destino ni como key. Se borro el enum TS duplicado y muerto `src/common/enums/station-ticket-status.enum.ts` (nadie lo importaba, confirmado por grep) y su re-export en `common/enums/index.ts`.

Transiciones vigentes: `PENDING -> IN_PROGRESS|CANCELLED`, `IN_PROGRESS -> READY|CANCELLED`.

## D. `KITCHEN` puede crear pedidos

`Role.KITCHEN` se agrego a `allowedRoles` en `create-waiter-order.service.ts` y `list-tables.service.ts` (mismos roles que ya tenia `WAITER`). `list-session-orders.service.ts` ya incluia `KITCHEN` desde antes, no se toco.

Motivacion: en cocinas chicas el mismo staff de cocina a veces toma pedidos directo (ej. mostrador), y antes solo `WAITER`/`ADMIN`/`SUPERVISOR` podian.

## F. Notificacion de "pedido listo" y auto-entrega

### Entrega compartida entre mesero y cocina

`deliver-order.service.ts`: `Role.WAITER` y `Role.KITCHEN` se agregaron a `allowedRoles` (antes solo `ADMIN`/`SUPERVISOR`/`CASHIER`). El frontend tampoco tenia hasta ahora ningun boton que llamara `POST /orders/:orderId/deliver`, asi que en la practica nadie usaba este endpoint — se reincorporo el permiso a `WAITER` (se le habia quitado en la revision de doc 15) y se extendio a `KITCHEN` al construir el flujo real de "marcar entregado".

### Auto-entrega configurable por sucursal

`BranchSettings` gano el campo `autoDeliverAfterMinutes Int?` (nullable = requiere confirmacion manual, comportamiento por defecto). Expuesto en `CreateBranchDto`/`UpdateBranchDto`/`BranchResponseDto` y sus mappers/servicios (`create-branch.service.ts`, `update-branch.service.ts`, `branch-mapper.ts`).

### Endpoint de resumen de listos por sucursal

`GET /api/v1/orders/branch-ready-summary?branchId=` (`list-branch-ready-summary.service.ts`). Registrado ANTES de `GET /orders/:orderId` en el controller para no chocar con la ruta parametrizada. Roles: `ADMIN`, `SUPERVISOR`, `WAITER`, `CASHIER`, `KITCHEN`, `BAR`.

Devuelve, por cada `TableSession` activa de la sucursal, en una sola query agregada (evita N+1):

```
{ tableSessionId, tableId, tableCode, openedByStaffUserId, readyUndeliveredCount }
```

`readyUndeliveredCount` es la cuenta de ordenes en `READY` sin entregar de esa sesion. `openedByStaffUserId` ya existia en el schema de `TableSession` desde antes pero no se exponia en ningun DTO de respuesta — este es el primer endpoint que lo expone; el frontend lo usa para el filtro "mis mesas".

### Auto-entrega perezosa

El mismo `list-branch-ready-summary.service.ts` aplica la auto-entrega: si `autoDeliverAfterMinutes` esta configurado, cualquier orden en `READY` cuyo tiempo transcurrido desde que su ultimo `StationTicket` se completo supere ese umbral se transiciona a `DELIVERED` (orden + items no cancelados) en una transaccion, ANTES de devolver la respuesta.

No hay `@nestjs/schedule` instalado en el proyecto — esto es expiracion perezosa evaluada al leer el endpoint, no un cron job. Implica que una sucursal sin trafico en ese momento no dispara la auto-entrega hasta que alguien vuelva a pedir el resumen (aceptable para el caso de uso: el resumen se consulta constantemente desde las pantallas de mesero/cocina mientras hay actividad).

## Backlog / pendiente

No implementado en esta ronda, documentado explicitamente como pendiente:

1. **Asignacion formal de mesas a un mesero especifico.** Hoy el filtro "mis mesas" del frontend usa `openedByStaffUserId` (quien abrio la sesion) como aproximacion interina — no cubre cambios de turno (si otro mesero toma la mesa a mitad de servicio, `openedByStaffUserId` no cambia).
2. **"Mesa virtual" para pedidos de mostrador/para llevar sin mesa fisica real** (patron usado por la competencia, ej. Toteat). Hoy toda orden requiere una `TableSession` sobre una `Table` real.
