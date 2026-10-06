# Mesas virtuales (pedidos sin mesa física)

> Nota de terminología: en la interfaz y la documentación la función se llama "mesa virtual" (antes "mostrador"). Los identificadores técnicos siguen usando `counter` (`isCounter`, `/floor/counter-sessions`, `COUNTER_TABLE_CODE`, código de mesa `MOSTRADOR`, carpeta `counter-board`, migración `counter_sessions`).

## Objetivo

Resuelve el backlog #2 de doc 17 / doc 18: permitir que el staff atienda clientes de paso (un café, un pedido para llevar, gente esperando de pie) sin una mesa física. Cada cliente es una sesión propia, con su `Bill`, sus `Order`, sus pagos y su ticket de cocina; puede haber una o muchas en simultáneo, sin límite ni pool. Reutiliza todo el flujo existente (`TableSession` → `Bill` → `Order` → `StationTicket` → `Payment`).

## Decisión de modelo (opción 1 + flag de sesión)

Doc 18 dejó tres alternativas. Se eligió la **opción 1** (una mesa virtual por sucursal que admite N sesiones concurrentes), pero en vez de relajar la regla "una sesión activa por mesa" para la mesa entera, la regla se mantiene y se excluyen las sesiones marcadas `isCounter`:

- `Table.isVirtual` identifica la mesa de mesa virtual; hay **exactamente una por sucursal**.
- `TableSession.isCounter` marca la sesión; el índice único "una activa por mesa" aplica solo a `is_counter = false`.
- La unicidad de lo que sí importa en mesa virtual (el número de ticket) se garantiza por separado.

Rechazadas:

- **Opción 2, pool de mesas virtuales** ("Para llevar 1", "Para llevar 2"…): impone un tope arbitrario de concurrencia y contamina el salón con mesas falsas.
- **Opción 3, modelo `CounterOrder` aparte**: duplica `TableSession`/`Bill`/`Order`/pagos/cocina; cada fix futuro habría que hacerlo dos veces.
- **Valor nuevo en un enum** (p. ej. `openedBySource = COUNTER`): no se agregó; `openedBySource` se deriva igual que en la apertura normal.

## Modelo de datos

Migración `20260801120000_counter_sessions` (SQL escrito a mano; ver "Índices raw").

- `Table.isVirtual Boolean @default(false)` (`is_virtual`), `Table.counterLastTicket Int @default(0)` (`counter_last_ticket`, contador rotativo de tickets).
- `TableSession.isCounter Boolean @default(false)` (`is_counter`), `ticketNumber Int?` (`ticket_number`), `customerLabel String?` (`customer_label`, máx. 40, recortado).
- La mesa virtual se busca **siempre** por `(branchId, isVirtual = true)`, nunca por código. Código `MOSTRADOR`, nombre `Mesa virtual`, `status = DISABLED` y `qrToken` aleatorio. `DISABLED` hace que los caminos QR y `open-table-session` ya la rechacen. Su `status` nunca se modifica.
- Se crea de forma perezosa, **fuera** de la transacción de apertura (`EnsureCounterTableService`): busca, si no existe crea, y ante `P2002` (carrera) vuelve a buscar.
- Borrar la mesa virtual borraría en cascada sus sesiones: no se expone ninguna vía de borrado.
- `create-table` rechaza el código `MOSTRADOR` (`trim().toUpperCase()`), y la migración renombra cualquier mesa real preexistente con ese código (sin distinguir mayúsculas) a `<código>-MESA`.

### Constraints

| Constraint | Regla |
|---|---|
| `table_sessions_counter_ticket_consistent` | `is_counter = (ticket_number IS NOT NULL)` |
| `table_sessions_ticket_number_range` | `ticket_number` entre 1 y 999 |
| `table_sessions_customer_label_length` | `char_length(customer_label) <= 40` |

### Índices raw (no los representa `schema.prisma`)

Prisma no modela índices parciales; viven solo en la migración. Igual que el índice de doc 20, **no deben borrarse en una migración autogenerada**.

- `tables_one_virtual_per_branch` — único `ON tables(branch_id) WHERE is_virtual`.
- `table_sessions_one_active_per_table` — **reemplazado**: mismo predicado de doc 20 (`status IN ('OPEN','PAYMENT_COMPLETED')`) más `AND is_counter = false`. Se crea primero como `..._v2`, se elimina el viejo y se renombra el `v2` con `ALTER INDEX ... RENAME`, de modo que el nombre queda estable.
- `table_sessions_one_active_counter_ticket` — único `ON table_sessions(branch_id, ticket_number) WHERE is_counter AND status IN ('OPEN','PAYMENT_COMPLETED')`: un número de ticket no se repite entre sesiones activas de la sucursal.
- `table_sessions_counter_branch_status_idx` — `ON table_sessions(branch_id, status) WHERE is_counter`, para el listado de la mesa virtual.

El SQL no declara transacción propia: se apoya en que Prisma ejecuta cada migración en una transacción en Postgres (el intercambio de índices depende de eso). **No se ha ejecutado contra una base real**; hay que hacer un dry-run en una base de prueba antes de desplegar. No hay cambio de RLS (no hay tablas nuevas).

## Asignación de tickets

Dentro de la transacción de apertura (`OpenCounterSessionService`):

```sql
UPDATE tables SET counter_last_ticket = counter_last_ticket % 999 + 1 WHERE id = $1::uuid RETURNING counter_last_ticket
```

El bloqueo de fila serializa a los concurrentes. Si el número resultante lo tiene una sesión de mesa virtual activa de la sucursal, se vuelve a incrementar (hasta 999 intentos). Si los 999 están tomados, o ante `P2002` del índice de ticket, responde `409 ConflictException`. Los números rotan 1..999 y se reutilizan una vez cerrada la sesión que los tenía.

## API

Todo bajo `/api/v1/floor`, mismo guard que el resto del módulo (`STAFF`). Roles: `ADMIN`, `SUPERVISOR`, `WAITER`, `CASHIER` (**no** `KITCHEN`; constante `COUNTER_SESSION_ROLES`).

- `POST /floor/counter-sessions` — body `{ branchId: uuid, customerLabel?: string (<=40, recortado) }`. Abre la sesión y su `Bill` (`OPEN`). `guestCount = 1`; `openedByStaffUserId` = quien llama; `assignedStaffUserId` = quien llama solo si `BranchSettings.tableAssignmentEnabled`; `openedBySource` = `CASHIER` solo si quien llama es cajero sin rol de mesero, si no `WAITER` (misma derivación que la apertura normal).
  Respuesta `CounterSessionResponseDto`: `{ tableSessionId, tableId, branchId, billId (string|null), ticketNumber, customerLabel (string|null), status, openedByStaffUserId, assignedStaffUserId, openedAt (ISO) }`.
- `GET /floor/counter-sessions?branchId=&mine=true|false` — sesiones de mesa virtual activas, ordenadas por `openedAt` ascendente, sin N+1. `mine=true` filtra por `openedByStaffUserId`. Cada ítem (`CounterSessionListItemDto`): `{ tableSessionId, billId, ticketNumber, customerLabel, status, openedByStaffUserId, openedAt, bill: { status, total, paid, remaining } (decimales como string), orders: [{ orderId, status }], readiness, readyAt? }`. `readyAt` solo viene cuando `readiness = READY` (el `updatedAt` más reciente de las órdenes `READY`).
- `PATCH /floor/counter-sessions/:tableSessionId` — body `{ customerLabel: string (<=40) }`; string vacío limpia a `null`. Devuelve `CounterSessionResponseDto`. `400` si la sesión no existe, no es de mesa virtual o no está activa.

### Guardas sobre la mesa virtual y las sesiones de mesa virtual

- `400 BadRequest` si se intenta: `open-table-session`, `get-current-table-session` o `set-table-zone` sobre una mesa virtual; `assign-table-session` sobre una sesión de mesa virtual (no hay "mesero de la mesa" que reasignar); crear una mesa con código `MOSTRADOR`.
- `list-tables` y la lista de mesas de `list-table-zones` filtran `isVirtual: false`: la mesa virtual nunca aparece en el salón.
- Servicios QR (`get-published-menu-by-qr`, `create-qr-order`, `list-qr-session-orders`, `create-bill-split`, `get-qr-bill`, `get-qr-order-payment-status`, `get-qr-payment-config`, `pay-qr-bill`, `pay-qr-order`, `start-redirect-payment`, `get-current-bill-split.executeForQrToken`) tratan `table.isVirtual` como mesa inexistente/deshabilitada (misma excepción de siempre, estilo 404): defensa en profundidad además de `DISABLED`.
- Analítica: `countTables` y `countOccupiedTables` excluyen la mesa virtual; `countOpenSessions` excluye sesiones de mesa virtual. No hay conteo separado de mesa virtual (diferido).

## Estados y rollup de readiness

El estado de una sesión de mesa virtual es el de cualquier `TableSession` (`OPEN` → `PAYMENT_COMPLETED` → `CLOSED`/`ABANDONED`). Para la pantalla se calcula `readiness` con la función pura `rollupCounterReadiness(statuses)` (`floor/domain/counter-readiness.ts`, con test unitario), **sin depender de los efectos del ready-summary**:

1. Se ignoran las órdenes `CANCELLED`.
2. Sin órdenes vivas → `EMPTY`.
3. Todas `DELIVERED` → `DELIVERED`.
4. Todas `READY` o `DELIVERED` con al menos una `READY` → `READY`.
5. Alguna `READY`/`PARTIALLY_READY` y alguna sin terminar → `PARTIALLY_READY`.
6. Alguna `IN_PREPARATION` → `PREPARING`.
7. Si no → `WAITING`.

## Comportamiento en el resto del backend

- **Cierre y abandono**: no hacen `table.update(AVAILABLE)` cuando `session.isCounter` (la mesa virtual no cambia de estado). El cierre exige `remaining <= 0` (`400 BadRequest` si no) y ademas `409 Conflict` mientras exista una orden no cancelada que no este `DELIVERED`.
- **Permisos solo para sesiones de mesa virtual**: `WAITER` tambien puede cobrar la cuenta (pay-bill, proveedor manual), cerrar y abandonar (el abandono exige motivo). Se extiende de forma acotada via `session.isCounter`; en mesas normales nada cambia.
- **Notificaciones "pedido listo"**: el push se dispara solo cuando la **orden** pasa a `READY` (no por cada ticket de estacion; el recalculo del estado bloquea la fila de la orden para que dos tickets listos a la vez no se pisen). El cuerpo lleva `#<ticket> <customerLabel?>` para mesa virtual y el codigo de mesa para mesas; `StationTicketReadyEvent` suma `label`/`isCounter`. Audiencia en mesa virtual: quien abrio la sesion mas todo el staff activo de la sucursal con rol `WAITER` o `CASHIER` (sin duplicados).
- **Ready-summary**: devuelve `isCounter/ticketNumber/customerLabel/assignedStaffUserId`, **no** auto-entrega sesiones de mesa virtual y la auto-entrega solo toca ordenes que siguen en `READY` (orden e items se actualizan en una transaccion interactiva).
- **Open-bills y mapper de tickets de cocina**: campos aditivos `isCounter`, `ticketNumber`, `customerLabel`; `tableCode` cae a `MOSTRADOR` para mesa virtual y la UI formatea la etiqueta traducida.
- `GET /floor/counter-sessions` omite sesiones activas sin `Bill` (no deberia ocurrir: la sesion y su cuenta se crean juntas).

### Limpieza de sesiones viejas

`abandon-stale-counter-sessions.scheduler.ts` (`@nestjs/schedule`, mismo patron que `reconcile-transbank-payments.scheduler.ts`, registrado en `floor.module.ts`) corre cada 15 min (`COUNTER_STALE_SWEEP_INTERVAL_MS`) y abandona sesiones de mesa virtual en `OPEN` o `PAYMENT_COMPLETED` con `openedAt` de hace mas de 12 h (`COUNTER_STALE_MAX_AGE_HOURS`), con el motivo constante `auto-expired`; las cuentas abiertas pasan a `ABANDONED`. Evita tickets fantasma que ocupen numeros y ensucien el tablero. Devuelve la cantidad realmente actualizada.

## Reglas para meseros

- Un cliente de mesa virtual = una sesión; "Nueva mesa virtual" crea la sesión sin nombre y se puede poner o cambiar la etiqueta después (`PATCH`).
- Cobrar, entregar y cerrar son por cliente; se cierra cuando está pagado y entregado.
- Los pedidos de mesa virtual no se mezclan con el salón: no aparecen en la grilla de mesas, la tira de listos ni los conteos de ocupación.
- Todo el staff operativo ve las sesiones de mesa virtual de la sucursal; "mías" es solo un filtro.

## Fuera de alcance (v1)

- Pantalla/ticket impreso para el cliente (display de números).
- Configuración de mesa virtual por sucursal (activar/desactivar, tope de tickets, vencimiento).
- Reembolsos más allá de la cancelación de órdenes existente.
- Conteo de analítica separado para mesa virtual.

## Verificacion

`tsc`, eslint y jest completo. Specs: `counter-readiness.spec.ts`, `ensure-counter-table.service.spec.ts`, `counter-sessions.service.spec.ts`, `virtual-table-guards.spec.ts`, `counter-lifecycle.spec.ts` (cierre, abandono, barrido), `abandon-table-session`, `pay-bill`, `station-ticket-ready.listener`, `update-station-ticket-status`, `list-branch-ready-summary`, `list-branch-open-bills` y `floor.dto.spec.ts` (`mine=false`). Pendientes conocidos: la migracion no se aplico ni probo contra Postgres (regla del proyecto: solo `prisma validate`/`generate`); el SQL de asignacion de ticket solo se probo con mocks; los cambios `isVirtual` en servicios QR no tienen test propio.
