# Floor Module

Responsable de mesas, sesiones de mesa y reglas de cierre o abandono.

## Estado actual

- mesas, apertura/retoma de sesion, cierre manual cuando la cuenta esta pagada
- `POST /api/v1/floor/table-sessions/:tableSessionId/abandon`: resolucion de deuda o abandono por caja, supervisor o admin; libera la mesa aunque quede saldo pendiente
- comensales (`guestCount`, requerido al abrir sesion) y zonas de mesas (`/zones`, `/tables/:tableId/zone`, `/zones/:zoneId/staff`, `/branch-staff`): ver doc 20
