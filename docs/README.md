# Sazono Backend Monolith - Docs

## Orden recomendado

1. [01 Product Context Backend](01-product-context-backend.md)
2. [02 Backend Architecture](02-backend-architecture.md)
3. [03 Backend AI Context](03-backend-ai-context.md)
4. [04 Implementation Plan](04-implementation-plan.md)
5. [05 Auth and Restaurant Bootstrap](05-auth-and-restaurant-bootstrap.md)
6. [06 API Curl Examples](06-api-curl-examples.md)
7. [07 Staff Management](07-staff-management.md)
8. [08 Floor and Table Sessions](08-floor-and-table-sessions.md)
9. [09 Billing and Manual Table Close](09-billing-and-manual-table-close.md)
10. [10 Menus and Preparation Stations](10-menus-and-preparation-stations.md)
11. [11 Orders and Kitchen](11-orders-and-kitchen.md)
12. [12 Payments](12-payments.md)
13. [13 Payments Split and Resolution](13-payments-split-and-resolution.md)
14. [14 Platform Admin and Analytics](14-platform-admin-and-analytics.md)
15. [15 Branch Access, Waiter Permissions and Stations](15-branch-access-and-waiter-permissions.md)
16. [16 Leads and Restaurant Search](16-leads-and-restaurant-search.md)
17. [17 Modificadores, Cocina Expedita y Notificaciones](17-modificadores-cocina-expedita-y-notificaciones.md)
18. [18 Asignación Formal de Mesas](18-asignacion-formal-de-mesas.md)
19. [19 Notificaciones Push y Login por PIN](19-notificaciones-push-y-login-por-pin.md)
20. [20 Comensales por Sesión y Zonas de Mesas](20-comensales-y-zonas-de-mesa.md)
21. [21 Integración de Mercado Pago](21-mercado-pago-integracion.md)
22. [22 Integración de Transbank Webpay Plus Mall](22-transbank-webpay-integracion.md)
23. [23 Arquitectura Multi-Proveedor de Pago](23-arquitectura-multi-proveedor-de-pago.md)
24. [24 Pagos: Visión General](24-pagos-vision-general.md)

Nota: dentro del bloque de pagos (12, 13, 21, 22, 23), lee primero el doc 24
aunque quede numerado al final — es el mapa completo (flujos de dinero, por
que hay dos pasarelas, que esta activo por configuracion, matriz de
capacidad) antes de entrar al detalle de cada uno. Quedo con el numero 24
porque se agrego despues, no por orden de lectura.

## Objetivo

Estos documentos existen para que una IA que trabaje en backend tenga el contexto de dominio, estados, restricciones y arquitectura que realmente necesita para implementar el sistema sin extrapolar reglas desde el frontend.
