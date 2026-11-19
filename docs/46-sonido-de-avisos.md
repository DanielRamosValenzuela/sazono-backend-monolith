# 46 - Sonido de avisos opcional (por dispositivo)

## Origen
El sonido del workflow de cocina no viene de la pagina: son las notificaciones push FCM (nueva orden para cocina/barra, ticket listo para meseros) que el sistema operativo del celular reproduce con el sonido por defecto. Ahora cada dispositivo puede silenciarlas desde el tablero de cocina.

## Diseno
- La preferencia es por dispositivo: `staff_device_tokens.sound_enabled` (boolean, default true). Migracion aditiva `20261128120000_push_sound_preference`.
- `PushNotificationService.sendToStaffUsers` divide los tokens en dos multicasts:
  - con sonido: `android.notification.sound = 'default'`, `channelId = 'sazono_alerts'`, `apns.aps.sound = 'default'`.
  - silenciados: `android.notification.channelId = 'sazono_silent'`, sin sonido apns.
  - La limpieza de tokens invalidos (`registration-token-not-registered`) recorre las respuestas de ambos envios.
- Canales Android (creados desde la web en `use-push-registration.ts` con `PushNotifications.createChannel`, solo en android, antes de `register()`):
  - `sazono_alerts`: importancia 4 (high), sonido por defecto, vibracion.
  - `sazono_silent`: importancia 2 (low), sin sonido ni vibracion.
  - Android no permite cambiar sonido/importancia de un canal ya creado; si se cambian, usar un id nuevo.
- Con la app en primer plano FCM no muestra la notificacion: la web programa una `LocalNotification`; usa `channelId` segun la preferencia (`isPushSoundEnabled()`), asi tambien respeta el silencio.

## Endpoints (staff autenticado, solo sobre su propio token)
Prefijo real del controlador existente: `/v1/notifications/device-tokens`.
- `GET /v1/notifications/device-tokens/me?fcmToken=...` -> `{ soundEnabled }` (404 si el token no es del usuario).
- `PATCH /v1/notifications/device-tokens/sound` body `{ fcmToken, soundEnabled }` -> `{ soundEnabled }` (404 si no es suyo).

## UI
Boton de bocina (44px) en el encabezado del tablero de cocina (`features/push-notifications/ui/sound-toggle.tsx`). Visible siempre; deshabilitado con el texto "Disponible en la app de cocina" cuando no hay token FCM (navegador normal). El token se expone con `useCurrentFcmToken()` (`device-token-registry.ts`). Al montar hace GET; al pulsar hace PATCH y muestra toast. `localStorage` solo da el valor inicial.

## APK
No requiere recompilar: la app carga la web remota (`server.url`) y el plugin `@capacitor/push-notifications` ya instalado trae `createChannel`. No hay cambios nativos.

## Probar en el emulador
1. Aplicar la migracion en la BD de QA (requiere autorizacion): `npx prisma migrate deploy`. Compilar y reiniciar el backend con las variables FIREBASE_* configuradas.
2. Abrir la app Sazono Staff, iniciar sesion como cocina, ir a Cocina y barra. El boton debe estar activo.
3. Ajustes del sistema > Apps > Sazono Staff > Notificaciones: deben existir "Avisos con sonido" y "Avisos silenciosos".
4. Crear una orden desde otra sesion: suena. Pulsar el boton (toast "Sonido de avisos desactivado"), crear otra orden: la notificacion llega sin sonido.
5. En un navegador de escritorio el boton aparece deshabilitado.
