# Leads y Búsqueda Pública de Restaurantes

## Objetivo

Este slice sostiene la landing de marketing (ver doc frontend 12): un formulario de contacto/demo real con backend, y un buscador publico para que un cliente existente encuentre la URL de login de su restaurante sin tener que recordarla.

## Módulo `leads`

Tabla nueva `leads` (Prisma model `Lead`), sin relacion con `restaurants` — es intencional: un lead es una persona interesada, no necesariamente alguien con un restaurante ya creado en Sazono.

Campos: `name`, `email`, `phone?`, `businessName?`, `intent` (`DEMO_REQUEST` | `GENERAL_INQUIRY`), `message?`, `status` (`NEW` | `CONTACTED` | `CLOSED`, se actualiza manualmente por ahora, no hay flujo de estados automatizado).

Endpoints:

- `POST /api/v1/leads` — **público**, sin autenticacion. Limitado a 3 requests/minuto (`@Throttle`, mas estricto que el default global de 100/60s) para frenar spam de un formulario expuesto sin captcha.
- `GET /api/v1/leads` — solo `platform_admin`, lista todos los leads mas recientes primero. Sin este endpoint el formulario "real" no serviria de nada — la data quedaria muerta en la base.

## Búsqueda pública de restaurantes

`GET /api/v1/restaurants/search?q=` — **público**, sin autenticacion. Prefijo de nombre (`startsWith`, case-insensitive), solo restaurantes `ACTIVE`, maximo 5 resultados, minimo 2 caracteres de busqueda (querys mas cortas devuelven `[]` sin tocar la base). Limitado a 10 requests/minuto.

Devuelve solo `{name, slug}` — nada sensible (ni `restaurantId`, ni cantidad de sucursales, ni datos de contacto). El slug es lo unico que necesita el frontend para armar el link a `/r/:slug/login`.

**Por que no es un problema de seguridad, pero si de exposicion de negocio:** el login real sigue exigiendo credenciales validas contra ESE restaurante especifico (ver doc 05) — nadie entra solo por saber el nombre. El riesgo real es que un buscador libre podria dejar enumerar la lista completa de clientes de Sazono (informacion de negocio, no de seguridad). Por eso: solo prefijo (no `contains` libre), resultados topados a 5, y throttle dedicado — no es una defensa perfecta contra scraping deliberado, pero sube el costo lo suficiente para un formulario de uso normal.

## Verificación

Tests unitarios para `CreateLeadService`, `ListLeadsService` y `SearchRestaurantsService`. Verificado end-to-end con Playwright: envio real del formulario de contacto desde la landing, el lead aparece en `GET /leads`, la busqueda de restaurante encuentra un restaurante real y no encuentra uno inexistente.
