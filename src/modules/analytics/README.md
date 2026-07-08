# Analytics Module

Expone `GET /branches/:branchId/summary`, el resumen operativo que consume el dashboard staff (mesas, sesiones abiertas, ventas de hoy, serie diaria, pedidos por estado y top productos). Solo accesible para roles `ADMIN`/`SUPERVISOR` de la sucursal.

Acepta `from`/`to` opcionales (`YYYY-MM-DD`, inclusive, deben venir juntos). Cuando se pasan, ese mismo rango se usa para la serie diaria (`dailySeries`), `ordersByStatus` y `topItems`; el rango no puede superar 92 dias. Sin `from`/`to` cada metrica usa su ventana historica por defecto (7 dias para la serie, hoy para pedidos por estado, 30 dias para top productos). `todayRevenue`, `todayPaymentsCount` y `averageTicket` siempre reflejan el dia de hoy, independiente del rango pedido.
