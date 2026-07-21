# Notificaciones Push y Login por PIN

## Objetivo

Resuelve los 3 pendientes de código dejados por `sazono-staff-app/docs/03-ai-context.md`
(push en primer plano, infra de push en backend, login por PIN) que no dependían
de la cuenta de Apple Developer Program. Este doc cubre el lado backend; ver doc
16 de `sazono-ui` para el lado frontend.

## A. Infra de push (Firebase Cloud Messaging)

### Modelo de datos

`StaffDeviceToken` (`staff_device_tokens`): `staffUserId` (FK a `StaffUser`,
`onDelete: Cascade`), `fcmToken`, `platform` (`'android' | 'ios' | 'web'`),
`createdAt`, `lastSeenAt`. `@@unique([staffUserId, fcmToken])` — un mismo
dispositivo puede re-registrarse (upsert) sin duplicar filas.

### Módulo nuevo `src/modules/notifications/`

- `common/firebase/firebase-admin.service.ts` (módulo `FirebaseModule`, `@Global()`,
  mismo patrón que `SupabaseModule`): envuelve `firebase-admin`. **Gateado por env** —
  si `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` no están
  las 3 presentes, `isEnabled` queda en `false` y loguea una advertencia al arrancar;
  no lanza excepción, no bloquea el arranque de la app.
- `PushNotificationService.sendToStaffUsers(staffUserIds, payload)`: junta los
  `fcmToken` de esos usuarios y llama `messaging().sendEachForMulticast(...)`; si
  `!isEnabled` o no hay tokens, `return` (no-op). Limpia automáticamente los tokens
  que Firebase reporta como `messaging/registration-token-not-registered`.
  `notifyBranchRoles(branchId, roles, payload)` es un atajo que resuelve
  `staffUserId`s vía `StaffUserBranchRole` (`status: ACTIVE`, rol en la lista).
- `DeviceTokensController`: `POST`/`DELETE /notifications/device-tokens`
  (`JwtAuthGuard` + `RequireProfileType(STAFF)`), usa `user.profileId` del token como
  `staffUserId` — el cliente nunca envía su propio id.

### Eventos de dominio (vía `EventEmitter2`, ya estaba registrado global pero inerte)

- `order.created` (`src/modules/orders/domain/order-events.ts`), emitido en
  `create-waiter-order.service.ts` **después** del `$transaction` (no dentro, para no
  notificar si la transacción falla). Escuchado por `OrderCreatedListener` →
  `notifyBranchRoles(branchId, [KITCHEN, BAR], ...)`.
- `station-ticket.ready` (`src/modules/kitchen/domain/station-ticket-events.ts`),
  emitido en `update-station-ticket-status.service.ts`, condicionado a
  `dto.status === StationTicketStatus.READY`, después del `$transaction`. Escuchado
  por `StationTicketReadyListener` → `sendToStaffUsers([order.createdByStaffUserId], ...)`.

Copy de estas notificaciones: en español, no localizado por perfil/restaurante (el
backend no tiene i18n) — follow-up si se vuelve un problema real.

## B. Login por PIN

### Modelo de datos (`StaffUser`)

`pinHash` (bcrypt, `bcryptjs`), `pinSetAt`, `pinFailedAttempts` (`@default(0)`),
`pinLockedUntil`. Ningún campo es obligatorio — un staff sin PIN configurado
simplemente tiene `pinHash: null`.

### Endpoints (`AuthController`/`AuthService`)

- `POST /auth/pin/set` (`JwtAuthGuard`): guarda `bcrypt.hash(pin, 10)` para el
  `profileId` del token. Rechaza con `403` si el perfil autenticado no es `STAFF`.
- `POST /auth/pin/login` (público, `@Throttle({ limit: 10, ttl: 60_000 })` además del
  `ThrottlerGuard` global): recibe `{ staffUserId, pin }`. El flujo:
  1. Busca el `StaffUser`; si no existe, no está `ACTIVE`, o no tiene `pinHash` →
     `401` genérico (`"PIN invalido."`), sin distinguir el motivo.
  2. Si `pinLockedUntil` está en el futuro → `401` sin comparar el PIN.
  3. `bcrypt.compare`; si falla, incrementa `pinFailedAttempts` y, al llegar a
     `PIN_MAX_FAILED_ATTEMPTS` (5), resetea el contador a 0 y fija
     `pinLockedUntil = now + 15min`.
  4. Si acierta, resetea el contador, resuelve el perfil (mismo `mapStaffUser`
     privado que ya usaba `resolveProfile` — se extrajo para reusarlo acá) y firma
     los mismos tokens que el login normal (`signTokens`).
- `staffUserId` es un UUID no enumerable — el lockout es la protección real contra
  fuerza bruta, no la opacidad del id.

## Migraciones — mismo gotcha que doc 18

`prisma migrate dev`/`diff` no funcionan en este proyecto (FK cruzada a
`auth.users` rompe la shadow DB y la introspección — ver doc 18 para el detalle
completo, no se repite acá). Se usó el mismo flujo: `migration.sql` escrito a mano
(`20260721100000_staff_device_tokens`, `20260721180000_staff_user_pin`) +
`prisma migrate deploy` (no usa shadow DB, aplica y registra en
`_prisma_migrations`).

## Bug real encontrado en integración (vive en `sazono-ui`, no acá)

El proxy de `sazono-ui` (`src/app/api/backend/[...path]/route.ts`) forzaba
`Content-Type: application/json` en la respuesta incluso cuando el backend
respondía con body vacío y sin ese header (exactamente el caso de estos 3
endpoints, que devuelven `void`) — el cliente intentaba `response.json()` sobre un
body vacío y tiraba `Unexpected end of JSON input`. Esto hacía que el registro de
token de dispositivo fallara **en silencio** desde el principio. Detalle completo y
fix en doc 16 de `sazono-ui`.

## Verificación

`auth.service.spec.ts` (login/lockout/set) y `push-notification.service.spec.ts`
(no-op sin Firebase, limpieza de tokens inválidos, resolución de roles) nuevos;
`create-waiter-order.service.spec.ts`/`update-station-ticket-status.service.spec.ts`
extendidos para verificar el `emit`. 46 suites / 165 tests, `tsc --noEmit` y
`eslint` limpios.

Verificado además en vivo (emulador Android, cuenta real `mesero1@gmail.com` /
Belifest providencia): login con contraseña → crear PIN → `pin_hash` guardado →
logout borra el device token → siguiente visita entra directo con PIN → PIN
incorrecto incrementa `pin_failed_attempts` y muestra error → PIN correcto entra y
resetea el contador. Confirmado por query directa a la base en cada paso, no solo
por la UI.

## Pendiente

1. **Envío real de push de punta a punta sin probar.** `FIREBASE_PROJECT_ID`/
   `FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` siguen vacías — se obtienen en
   Firebase Console → Project Settings → Service Accounts → Generate new private
   key. Sin esto, `PushNotificationService` es un no-op silencioso (ver `A.`).
2. iOS sigue bloqueado por falta de cuenta Apple Developer Program (sin cambios,
   ver docs de `sazono-staff-app`).
