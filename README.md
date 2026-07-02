# Sazono Backend Monolith

Backend principal de Sazono construido con NestJS.

## Arquitectura

- monolito modular
- orientado a dominio
- hexagonal selectiva en bordes como pagos e integraciones externas

## Estructura inicial

```text
src/
  common/
    enums/
  modules/
    restaurants/
    branches/
    staff/
    menus/
    floor/
    orders/
    kitchen/
    billing/
    payments/
```

## Documentacion

- [Backend docs](D:\Programacion\Sazono\sazono-backend-monolith\docs\README.md)

## Scripts

```bash
npm run start:dev
npm run test
npm run lint
```
