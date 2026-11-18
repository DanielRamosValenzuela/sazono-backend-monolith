# 41. Opciones anidadas (contrato backend)

Diseno: `docs/41-diseno-opciones-anidadas.md` del repo raiz. Aqui solo el contrato implementado.

## Modelo y reglas

- `ModifierGroup.parentOptionId` (nullable, inmutable): un grupo hijo se abre al elegir su opcion padre. Maximo 3 niveles (`MODIFIER_MAX_DEPTH`). `PATCH` de grupo rechaza `parentOptionId` (el ValidationPipe usa `forbidNonWhitelisted`).
- `POST /menus/modifier-groups` acepta `parentOptionId`: la opcion debe existir en la misma sucursal y el nivel resultante no puede pasar de 3 (400).
- `PUT` de grupos de un item rechaza grupos con padre (400). `GET /menus/modifier-groups` devuelve solo raices con `childGroups` anidados.
- No existe borrado de opciones/grupos; la disponibilidad se maneja con `isAvailable` (ver abajo). El borrado en cascada de la BD queda para el futuro.
- Duplicar carta no cambia: copia enlaces a grupos raiz y los sub-grupos viajan con la opcion padre (spec lo fija). Editar un sub-grupo afecta a todas las cartas.

## Respuestas de carta (aditivas)

- `ModifierGroupResponseDto`: `parentOptionId: string | null`, `depth: 1..3`.
- `ModifierOptionResponseDto`: `childGroups: ModifierGroupResponseDto[]`.
- Detalle de carta y publicacion (admin): arbol completo, `isAvailable` crudo.
- Carta QR publica: arbol completo con disponibilidad efectiva: una opcion es no disponible si `isAvailable=false` o si tiene un sub-grupo requerido sin opciones efectivamente disponibles; una opcion no disponible expone `childGroups: []`.

## Pedido

Payload sin cambios: `modifierOptionIds` plano (tope subido de 20 a 30). El servidor reconstruye el arbol (`resolveModifierSelection`, `menus/domain/modifier-tree.ts`):

1. ids duplicados -> 400; id fuera del arbol del item -> 400; opcion no efectivamente disponible -> 400.
2. opcion hija sin su padre seleccionado -> 400.
3. Solo se validan grupos alcanzables (raices y los hijos de opciones elegidas): minimo (`isRequired` => al menos 1), maximo y `ONE` => maximo 1, por nivel.
4. Precio unitario = precio base + suma de los `priceDelta` de todos los nodos; si queda bajo 0 -> 400.

`OrderItemModifier` guarda `parentOrderItemModifierId`, `depth` y `pathSnapshot` (`["Papas","Duquesa"]`); `nameSnapshot` sigue siendo solo el nombre. Los ids se generan en memoria y se insertan con `createMany` anidado, padres primero (`buildOrderItemModifierRows`).

## Salidas

- Orden (`OrderItemModifierResponseDto`): `parentModifierOptionId`, `depth`, `path` ademas de lo existente.
- Comanda de cocina: `modifiers: string[]` con una linea por hoja y la ruta completa: `Papas > Duquesa`, `Salsa BBQ` (`formatModifierLines`). Nodos intermedios con hijos no se repiten.
- Detalle de orden de reportes: `modifiers[]` agrega `path` y `depth` (filas antiguas sin snapshot: `[name]` y `1`). `modifiersTotal`/`baseUnitPrice` siguen sumando todos los nodos.
- Jerarquia, Z diario y reembolsos por item: sin cambios (`SUM(price_delta_snapshot)` ya incluye todos los nodos).
- Cuenta: `BillItem.description` no cambia (solo nombre del item).

## Pendiente

- Advertencia de publicacion por opcion con sub-grupo requerido sin opciones disponibles.
- El cliente Android de meseros y clientes viejos fallan con 400 si el dueno marca un sub-grupo como requerido: desplegar clientes nuevos antes.
