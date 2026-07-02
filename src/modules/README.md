# Modules

Cada carpeta representa un modulo de negocio del monolito.

Estructura sugerida por modulo:

- `domain`: reglas e invariantes
- `application`: casos de uso
- `infrastructure`: persistencia e integraciones
- `presentation`: controllers y DTOs

No meter servicios gigantes cruzando modulos.
