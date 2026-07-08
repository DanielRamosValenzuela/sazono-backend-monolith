# Billing Module

Responsable de cuenta de mesa, bill items, split bill y saldo pendiente.

En la iteracion actual expone la `Bill` operativa por `TableSession` y sostiene la regla de una cuenta unica por sesion.

`GET /branches/:branchId/open-bills` lista las cuentas de todas las sesiones activas de la sucursal en una sola consulta (evita N+1), usado por el frontend para una vista consolidada de saldos pendientes.
