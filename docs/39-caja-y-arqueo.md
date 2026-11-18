# 39. Caja y arqueo (M8b)

Implementa las secciones 1, 7, 8, 9.1 y 9.2 de `docs/38-diseno-m8-descuentos-arqueo-reembolso-por-item.md` del repo de documentos. Migracion: `20261124120000_cash_sessions` (aplicar solo con `prisma migrate deploy`, migracion primero y codigo despues).

## Modelo

- `CashSession`: una sesion OPEN por (sucursal, etiqueta sin distinguir mayusculas) y una por (sucursal, cajero). Los indices unicos parciales viven solo en el SQL de la migracion.
- `Payment.cashSessionId`: se llena al cobrar con un staff que tiene sesion abierta (cualquier medio, el esperado solo suma `method = CASH` y `status = PAID`). Pagos QR sin staff quedan en NULL.
- `CashMovement.cashSessionId` e `idempotencyKey` (unico por sucursal, staff y clave).
- `BranchSettings.requireOpenCashSession` (default false): si es true, cobrar efectivo manual o registrar un movimiento sin sesion abierta responde 409 `CASH_SESSION_REQUIRED`.

## Formula

```
expectedCash = openingFloat + Σ pagos CASH PAID de la sesion (propina incluida) + Σ cash_movements.amount de la sesion
difference   = countedCash - expectedCash        (negativo = faltante)
```

Signos: CASH_IN positivo; CASH_OUT, REFUND_OUT y TIP_PAYOUT negativos; ADJUSTMENT con signo. El servidor aplica el signo en CASH_IN/CASH_OUT. El `REFUND_OUT` queda ligado a la sesion abierta de quien entrega el dinero (`refund-payment.service.ts`).

## Endpoints (prefijo /v1/branches/:branchId)

| Ruta | Roles | Notas |
|---|---|---|
| `POST cash-sessions/open` | ADMIN, CASHIER | `{ registerLabel?, openingFloat }`. Reintento identico del mismo cajero devuelve la sesion abierta. 409 `CASH_SESSION_ALREADY_OPEN`, `CASHIER_HAS_OPEN_SESSION`. |
| `GET cash-sessions/current` | ADMIN, SUPERVISOR, CASHIER | `{ session | null }` con esperado en vivo. |
| `GET cash-sessions` | ADMIN, SUPERVISOR (todas); CASHIER (propias) | filtros `status`, `limit`. |
| `GET cash-sessions/:id` | idem | sesion + pagos + movimientos. |
| `POST cash-sessions/:id/close` | CASHIER (propia), ADMIN, SUPERVISOR | `{ countedCash, closingNote?, denominations? }`. Nota obligatoria si hay diferencia (400 `CASH_SESSION_NOT_OWNER` para sesion ajena sin ser ADMIN). Devuelve `{ session, warnings: { openBills, partialBillsCollectedInSession } }`. |
| `POST cash-sessions/:id/force-close` | ADMIN, SUPERVISOR | igual, nota siempre obligatoria; marca `forced`. |
| `POST cash-movements` | ADMIN, CASHIER | `{ type: CASH_IN|CASH_OUT, amount > 0, reason >= 3 }` + header `Idempotency-Key`. |
| `POST cash-movements/adjustments` | ADMIN | `{ amount != 0 con signo, reason, cashSessionId? }` + `Idempotency-Key`. |
| `GET cash-movements` | ADMIN, SUPERVISOR (todos); CASHIER (propios) | filtros `type`, `cashSessionId`, `from`, `to`, `limit`. |
| `GET /v1/reports/branches/:branchId/cash-sessions` | ADMIN, SUPERVISOR; CASHIER solo hoy y propias | rango por fecha de apertura, totales, diferencia por cajero, `format=csv`. |

El cierre toma `SELECT ... FOR UPDATE` de la sesion y recalcula el esperado dentro de la transaccion; un cobro concurrente toma `FOR SHARE` (`find-open-cash-session.ts`) y o entra al cierre o cae al camino sin sesion.

Cerrar con cuentas abiertas se permite y devuelve advertencias. Sesion olvidada: `force-close`. No hay cierre automatico.

## Z diario

`cashClosing.sessions` lista las sesiones abiertas en el dia con apertura, ventas en efectivo, movimientos, esperado, contado y diferencia. `cashClosing.rows` sigue calculandose por fecha para los dias sin sesiones.

## Auditoria

`CASH_SESSION_OPENED`, `CASH_SESSION_CLOSED`, `CASH_SESSION_FORCE_CLOSED`, `CASH_MOVEMENT_CREATED`, `CASH_ADJUSTMENT_CREATED`.

## UI (sazono-ui)

Ruta `/staff/caja` (widget `cash-register`), tarjeta "Mi caja" en `/staff` y entrada "Caja" en el menu para ADMIN, SUPERVISOR y CASHIER. Mobile first con hojas inferiores.

## Pendiente

Boton de reporte de sesiones y seccion por sesion en el Z de la UI de reportes; detalle de una sesion cerrada en la UI; E2E contra QA y prueba en celular.
