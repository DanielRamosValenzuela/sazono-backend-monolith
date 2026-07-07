# Payments and Operational Resolution

## Objetivo

Este slice cierra los flujos operativos finales del MVP backend:

- split bill simple dentro de la misma cuenta
- entrega de ordenes listas
- cancelacion de ordenes antes o durante produccion
- resolucion de abandono o deuda por supervisor o caja

## Endpoints split bill

### Staff

- `POST /api/v1/payments/bills/:billId/splits`
- `GET /api/v1/payments/bills/:billId/splits/current`

### QR publico

- `POST /api/v1/qr/tables/:qrToken/bill/splits`
- `GET /api/v1/qr/tables/:qrToken/bill/splits/current`
- `POST /api/v1/qr/split-participants/:participantToken/pay`

## Endpoints orders (staff)

- `POST /api/v1/orders/:orderId/deliver`
- `POST /api/v1/orders/:orderId/cancel`

## Endpoints floor (staff)

- `POST /api/v1/floor/table-sessions/:tableSessionId/abandon`

## Reglas activas

### Split bill simple

- solo si la sucursal tiene `splitBillEnabled`
- la cuenta debe estar `OPEN` o `PARTIALLY_PAID` con saldo pendiente
- solo un split activo por cuenta
- modo `BY_AMOUNT`: la suma de las partes debe coincidir exactamente con el saldo pendiente
- cada participante recibe un `participantToken` para pagar su parte desde QR
- el pago del participante liquida su parte asignada restante mas propina opcional
- el split y sus participantes avanzan a `PARTIALLY_PAID` o `PAID` segun corresponda

### Entrega

- solo se puede entregar una orden en estado `READY`
- marca la orden y sus items activos como `DELIVERED`

### Cancelacion de orden

- antes de produccion (`DRAFT`, `AWAITING_PAYMENT`, `PAYMENT_FAILED`): cualquier staff operativo puede cancelar
- en produccion: solo `ADMIN` o `SUPERVISOR`; revierte bill items abiertos, recalcula la cuenta y cancela tickets
- ordenes prepagadas en produccion no se anulan desde aqui (requieren reembolso)

### Abandono o deuda

- solo `ADMIN`, `SUPERVISOR` o `CASHIER`
- requiere motivo obligatorio
- la sesion y la cuenta pasan a `ABANDONED` aunque quede saldo pendiente
- la mesa vuelve a `AVAILABLE`

## Definition of Done alcanzada

Con este slice el backend MVP cubre el flujo completo:

1. carta publicada
2. mesa abierta
3. pedidos QR y mesero
4. tickets por estacion
5. pagos totales, parciales y split
6. cierre manual o abandono de mesa
