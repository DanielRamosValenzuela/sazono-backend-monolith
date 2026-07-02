# Backend Architecture

## Recomendacion principal

No te recomiendo empezar con hexagonal pura en todo el proyecto.

Te recomiendo algo mas pragmatica y sostenible para este caso:

- monolito modular
- orientado a dominio
- con ideas de hexagonal en los bordes importantes

En otras palabras:

- **modular monolith first**
- **ports and adapters where it matters**

## Por que no hexagonal pura desde el dia uno

Porque hoy el proyecto esta recien partiendo y una hexagonal estricta puede meterte:

- demasiadas interfaces vacias
- mucho boilerplate
- capas ceremoniales
- lentitud para iterar

Para Sazono, el verdadero valor temprano no esta en tener 40 adapters perfectos. Esta en fijar bien:

- estados
- permisos
- invariantes
- transiciones

## Donde si aplicaria pensamiento hexagonal

Si lo aplicaria en fronteras que probablemente cambien:

- pagos
- almacenamiento de media
- autenticacion externa
- notificaciones

Ahi si conviene usar puertos y adapters.

## Estructura sugerida

```text
src/
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
  common/
    auth/
    db/
    events/
    errors/
    types/
```

Dentro de cada modulo:

```text
module-name/
  application/
  domain/
  infrastructure/
  presentation/
```

## Significado de cada capa

### `domain`

- entidades de dominio
- value objects
- reglas invariantes
- enums de estado

### `application`

- casos de uso
- orquestacion
- comandos
- permisos de alto nivel

### `infrastructure`

- persistencia
- integracion con Supabase/Postgres
- gateways externos

### `presentation`

- controllers
- dtos
- mappers request/response

## Recomendacion concreta para NestJS

Nest funciona muy bien si cada modulo de negocio expone:

- controller
- service de caso de uso
- repository abstraction donde tenga sentido

Pero no todo necesita interface desde el principio. Mi consejo:

- interfaces en pagos y servicios externos
- menos ceremonia en repos internos mientras el dominio aun se estabiliza

## Reglas de diseño

1. No poner toda la logica en services gigantes de Nest.
2. No dejar las reglas de negocio solo en controllers o DTOs.
3. No acoplar pagos, ordenes y billings en un solo modulo monstruo.
4. Cada modulo debe conocer bien su responsabilidad.
5. Las transiciones de estado deben vivir en application/domain, no repartidas al azar.

## Recomendacion arquitectonica final

Si me preguntas de forma directa:

- **Backend**: modular monolith con estilo domain-driven y hexagonal selectiva

No haria microservicios ahora.
No haria hexagonal purista ahora.
No haria solo controllers + services + repositories anemicos tampoco.
