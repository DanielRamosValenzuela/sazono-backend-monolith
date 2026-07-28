# Arquitectura multi-proveedor de pago

## Objetivo

Doc de referencia para el diseño que permite a Sazono tener mas de una
pasarela de pago real conectada por restaurante (hoy: Mercado Pago y
Transbank Webpay) sin que agregar una tercera obligue a tocar el resolver,
el registro de adapters, ni `ChargePaymentService`. No repite el detalle
especifico de cada proveedor -- eso vive en doc 21 (Mercado Pago) y doc 22
(Transbank) -- ni el detalle linea a linea de cada endpoint, que vive en
`src/modules/payments/README.md`. Esta doc explica el **patron**: los cinco
componentes que lo forman, por que estan separados asi, y como se agrega un
proveedor nuevo paso a paso.

Lectura recomendada antes de tocar `src/modules/payments/infrastructure/` o
de agregar un tercer `PaymentGatewayPort`.

## El problema que resuelve

Antes de este diseño, el unico proveedor (Mercado Pago) se resolvia
construyendo un `MercadoPagoGatewayAdapter` **nuevo, por request**, con el
`accessToken` del restaurante pasado al constructor. Eso funciona con un
proveedor, pero no escala a varios: cada adapter tendria su propia forma de
credencial, el resolver tendria que conocer la clase concreta de cada uno, y
"cual pasarela ofrecerle al cliente" era una decision binaria (conectada o
no), no una lista con prioridad. El refactor que describe esta doc resuelve
los tres problemas con cinco piezas que no se tocan entre si al agregar un
proveedor:

1. Un puerto (`PaymentGatewayPort`) con un resultado discriminado que
   distingue pasarelas de liquidacion inmediata de pasarelas de
   redireccion, en vez de un `approved: boolean` que asumia lo primero.
2. Adapters sin estado, registrados como singletons de Nest, con la
   credencial de cada restaurante viajando en cada llamada en vez de vivir
   en el constructor.
3. Un registro (`PaymentGatewayRegistry`) que descubre adapters
   automaticamente via `DiscoveryService` + un decorador, en vez de que el
   resolver los conozca por nombre de clase.
4. Un resolver (`PaymentGatewayResolverService`) que devuelve **todas** las
   cuentas conectadas de un restaurante, ordenadas por prioridad, en vez de
   una sola.
5. Un modelo de datos (`RestaurantPaymentAccount`) unico por
   `(restaurantId, provider)`, con `displayPriority` para el orden y
   `status` para pausar sin desconectar.

## 1. El puerto: `GatewayChargeOutcome` discriminado por `kind`

`application/ports/payment-gateway.port.ts`:

```ts
export type GatewaySettledResult = 'APPROVED' | 'REJECTED';

export type GatewayChargeOutcome =
  | {
      kind: 'SETTLED';
      result: GatewaySettledResult;
      providerReference?: string;
      failureReason?: string;
      rawStatus?: string;
      rawStatusDetail?: string;
    }
  | {
      kind: 'REDIRECT';
      providerReference: string;
      redirectUrl: string;
      method: 'POST';
      fields: Record<string, string>;
      expiresAt: Date;
    };

export interface PaymentGatewayPort {
  readonly providerName: string;
  readonly checkoutMode: 'embedded' | 'redirect';

  charge(context: GatewayChargeContext): Promise<GatewayChargeOutcome>;
  confirmRedirect?(
    providerReference: string,
    credentials: GatewayCredentials,
  ): Promise<GatewayChargeOutcome>;
  getPayment(
    providerReference: string,
    credentials: GatewayCredentials,
  ): Promise<GatewayPaymentSnapshot | null>;
}
```

`SETTLED` es una pasarela como Mercado Pago que resuelve el cobro en la
misma llamada HTTP (`binary_mode: true`, nunca `pending`). `REDIRECT` es una
pasarela como Transbank que necesita mandar al cliente a una URL externa
antes de saber el resultado; `confirmRedirect` es opcional en el puerto
porque solo lo implementan las pasarelas `redirect` (Mercado Pago no lo
define).

**Por que esto importa mas que el resto del refactor junto**: todo
consumidor del puerto maneja el resultado con un `switch (outcome.kind)`
exhaustivo, cerrado con `assertNever` (`domain/assert-never.ts`):

```ts
switch (outcome.kind) {
  case 'SETTLED':
    /* ... */
    break;
  case 'REDIRECT':
    /* ... */
    break;
  default:
    return assertNever(outcome); // no compila si falta un caso
}
```

Si el dia de mañana se agrega un tercer `kind` (poco probable, pero el punto
es estructural) o si alguien intenta usar una pasarela `redirect` donde el
codigo asume `SETTLED`, **el build falla en vez de fallar en produccion**.
Esto es lo que impide, en el nivel del compilador, que una pasarela de
redireccion termine marcando una orden como pagada o fallida por accidente
antes de que el cliente complete el pago.

Hay dos familias de consumidores de este switch, porque no todos los casos
de uso pueden aceptar ambas ramas:

- **Casos de uso de checkout embebido** (`ChargePaymentService`,
  `pay-qr-order`, `settle-bill-payment` usado por `pay-qr-bill`/`pay-bill`,
  `pay-bill-split-participant`): reciben `checkout` (`cardToken` +
  `paymentMethodId` + `installments`) en el mismo request. Un `REDIRECT` ahi
  es un error de uso -- esas pasarelas no soportan mandar datos de tarjeta
  directo -- asi que el helper compartido `application/require-settled-charge.ts`
  lo convierte en un `ConflictException` explicito, nunca en un exito o
  fracaso silencioso.
- **Casos de uso de redireccion** (`StartRedirectPaymentService`,
  `ConfirmRedirectPaymentService`): manejan ambas ramas de verdad. El primero
  espera un `REDIRECT` (si la pasarela devuelve `SETTLED` ahi, es lo
  inesperado y tambien se trata como error explicito, ver doc 22). El
  segundo espera `SETTLED` tras confirmar (un `REDIRECT` ahi tambien es un
  error explicito).

Ninguno de los dos tiene un `default` silencioso: **ambas ramas siempre se
manejan**, la diferencia es que "manejar" a veces significa "aplicar el
resultado" y a veces significa "rechazar con un mensaje claro porque este
endpoint no soporta ese tipo de pasarela".

## 2. Adapters: singletons sin estado, credenciales por-llamada

`MercadoPagoGatewayAdapter` y `WebpayMallGatewayAdapter` son providers
normales de Nest (`@Injectable()`, registrados en el array `providers` de
`payments.module.ts`, un solo singleton compartido por toda la app). No
reciben ningun `accessToken`/`childCommerceCode` en el constructor -- solo
configuracion de **plataforma** que es igual para todos los restaurantes
(timeouts, `MercadoPagoConfigService`/`TransbankConfigService`, el codigo de
comercio Mall de Transbank). La credencial de cada restaurante viaja como
parte del `context` en cada llamada:

```ts
charge(context: GatewayChargeContext): Promise<GatewayChargeOutcome>;
// context.credentials: { accessToken?: string; childCommerceCode?: string }
```

Esto es lo que permite que un solo proceso Node atienda a N restaurantes con
N credenciales distintas del mismo proveedor sin instanciar N objetos: el
adapter es puro respecto a la credencial, la recibe y la usa, nunca la
guarda entre llamadas.

## 3. Registro automatico: decorador + `DiscoveryService`

`domain/payment-gateway-adapter.decorator.ts` define un `Symbol` de
metadata y una funcion `@PaymentGatewayAdapter(provider)` que hace
`SetMetadata` sobre la clase:

```ts
@Injectable()
@PaymentGatewayAdapter(PaymentGatewayProvider.MERCADO_PAGO)
export class MercadoPagoGatewayAdapter implements PaymentGatewayPort { ... }
```

`infrastructure/payment-gateway-registry.service.ts` (`PaymentGatewayRegistry
implements OnModuleInit`) inyecta `DiscoveryService` y `Reflector` de
`@nestjs/core`. En `onModuleInit`, recorre `discoveryService.getProviders()`
(todos los providers de la app, no solo los del modulo de pagos), lee la
metadata del decorador sobre cada `wrapper.instance.constructor`, y arma un
`Map<PaymentGatewayProvider, PaymentGatewayPort>`. Expone `get(provider)` y
`getAll()`.

**Orden de inicializacion, verificado con un test real**: el riesgo obvio de
este patron es que `PaymentGatewayRegistry.onModuleInit` corra antes de que
Nest haya terminado de instanciar los adapters decorados, dejando el mapa
vacio. `infrastructure/payment-gateway-registry.service.spec.ts` cubre esto
explicitamente: crea un `TestingModule` con un adapter decorado de prueba,
llama `app.init()` (que dispara todos los `onModuleInit` en el orden que
Nest garantiza -- proveedores primero, luego los hooks del modulo) y
confirma que `registry.get(provider)` devuelve la MISMA instancia que
`app.get(FakeAdapter)`. Este test pasa hoy (ver corrida de test suite en el
reporte de esta tarea); no hizo falta ningun ajuste de orden porque
`DiscoveryService.getProviders()` ya lee el `ModulesContainer` completo, que
para cuando corre cualquier `onModuleInit` ya tiene todas las instancias
creadas (Nest crea todas las instancias de un modulo antes de llamar
`onModuleInit` de ninguna).

**Por que un decorador + discovery y no un array explicito en el modulo**:
un array (`providers: [MercadoPagoGatewayAdapter, WebpayMallGatewayAdapter]`
mas otro array `GATEWAY_ADAPTERS = [MercadoPagoGatewayAdapter, ...]` inyectado
en el resolver) funcionaria igual de bien con dos proveedores, pero cada
proveedor nuevo tocaria dos lugares (el modulo Y ese array). El registro no
necesita saber la lista de proveedores existentes.

## 4. El resolver: todas las opciones conectadas, no una

`PaymentGatewayResolverService.resolveAvailable(restaurantId)`:

```ts
async resolveAvailable(restaurantId: string): Promise<ResolvedPaymentGateway[]> {
  const accounts = await this.restaurantPaymentAccountRepository
    .findConnectedByRestaurant(restaurantId); // status: CONNECTED, orderBy displayPriority desc, connectedAt asc
  // por cada cuenta: busca el adapter en la registry, resuelve credenciales, arma ResolvedPaymentGateway
}
```

`findConnectedByRestaurant` filtra `status: CONNECTED` (ni `PAUSED` ni
`DISCONNECTED` ni `ERROR` aparecen) y ordena por `displayPriority DESC,
connectedAt ASC` -- el `[0]` del arreglo es siempre "la preferida". Los
consumidores usan esto de dos formas distintas:

- `ChargePaymentService` (checkout embebido) toma `[0]` directo: cobra
  siempre con la preferida.
- `GetQrPaymentConfigService` expone el arreglo completo como `options[]`
  (`GET .../payment-config`) para que el cliente elija; marca
  `isPreferred: true` solo en la primera opcion del arreglo devuelto.
- `StartRedirectPaymentService` filtra el arreglo por `provider` +
  `checkoutMode === 'redirect'`: el cliente elige explicitamente que
  pasarela usar (via el picker del frontend), no toma la preferida a ciegas.

La resolucion de credenciales por proveedor (`resolveCredentials`, dentro
del propio resolver) es la unica pieza que **si** necesita un caso nuevo por
proveedor -- ver seccion siguiente.

## 5. Agregar un proveedor #3, paso a paso

Este es el flujo real que siguio Transbank al agregarse sobre Mercado Pago,
generalizado. Ninguno de estos pasos toca `ChargePaymentService`,
`PaymentGatewayRegistry`, ni los endpoints `.../pay` existentes.

1. **Enum**: agregar el valor al enum Prisma `PaymentGatewayProvider` y
   migrar (migracion aditiva, `ALTER TYPE ... ADD VALUE`). No hace falta
   tocar `RestaurantPaymentAccount` ni `PaymentWebhookEvent`: ya son unicos
   por `(restaurantId/provider, ...)`.
2. **Adapter**: crear la clase en
   `infrastructure/<proveedor>/<proveedor>-gateway.adapter.ts` implementando
   `PaymentGatewayPort`. Decidir `checkoutMode`:
   - `'embedded'` si la pasarela puede recibir un token de tarjeta generado
     en el navegador y cobrar en la misma llamada (`kind: 'SETTLED'`
     siempre) -- como Mercado Pago.
   - `'redirect'` si el cliente tiene que salir a un sitio externo a pagar
     (`kind: 'REDIRECT'` en `charge()`, e implementar `confirmRedirect`) --
     como Transbank.
   Decorar la clase: `@PaymentGatewayAdapter(PaymentGatewayProvider.NUEVO)`.
3. **Config de plataforma**: si el proveedor necesita credenciales propias
   de Sazono (no del restaurante), un `<Proveedor>ConfigService` propio
   leyendo `.env`, siguiendo el patron de `TransbankConfigService`
   (`isEnabled`, falla claro con un mensaje si falta una variable requerida
   y `ENABLED=true`, nunca rompe el arranque si `ENABLED=false`).
4. **Modulo**: registrar el adapter (y su config service, si aplica) como
   provider normal en `payments.module.ts`. Este es el unico lugar de
   wiring manual -- Nest no escanea el filesystem, asi que el provider tiene
   que declararse aunque el decorador se encargue del resto.
5. **Credenciales en el resolver**: agregar el caso nuevo en el switch de
   `PaymentGatewayResolverService.resolveCredentials` (`GatewayCredentials`
   puede necesitar un campo nuevo si la forma de credencial no es
   `accessToken` ni `childCommerceCode`). Es intencional que este switch sea
   exhaustivo con `assertNever`: agregar el enum sin agregar el caso aca
   rompe el build, no falla en runtime.
6. **Conexion de cuenta por restaurante**: un servicio + endpoints en
   `PaymentAccountsController` para que el restaurante conecte su cuenta.
   Dos patrones ya existen como referencia:
   - **OAuth** (Mercado Pago): `StartPaymentAccountConnectionService` +
     `CompletePaymentAccountConnectionService`, si el proveedor ofrece un
     flujo de autorizacion.
   - **Manual** (Transbank): `ConnectTransbankAccountService`, un simple
     `POST` con el dato publico que identifica la cuenta (sin secreto del
     restaurante que guardar, si el proveedor no lo requiere).
   Los endpoints genericos `PATCH .../:provider/pause`, `/resume` y
   `/preferred` (`PausePaymentAccountService`, `ResumePaymentAccountService`,
   `SetPreferredPaymentAccountService`) funcionan para cualquier `provider`
   sin cambios -- no hace falta tocarlos.
7. **Si `checkoutMode: 'redirect'`**: el proveedor nuevo puede reusar
   `StartRedirectPaymentService`/`ConfirmRedirectPaymentService` sin
   modificarlos (ya son genericos por `provider`/`checkoutMode`), siempre
   que el flujo real del proveedor calce con "creo la transaccion, devuelvo
   una URL + campos para un form-POST, el cliente vuelve con un token que
   confirmo el resultado". Si el proveedor nuevo no tiene webhooks (como
   Transbank), replicar el patron de
   `ReconcileTransbankPaymentsService`/`ReconcileTransbankPaymentsScheduler`
   para conciliar por polling; si SI tiene webhooks (como Mercado Pago),
   replicar `PaymentWebhooksController`/`HandleMercadoPagoWebhookService`.
8. **`.env.example`**: documentar cada variable nueva con un comentario
   claro (que hace, si es obligatoria, valores de prueba si el proveedor
   publica un ambiente de integracion) y al menos una URL a la doc oficial
   del proveedor.
9. **Tests**: replicar el patron de mocks planos de
   `webpay-mall-gateway.adapter.spec.ts` (mockea el cliente HTTP/SDK del
   proveedor, nunca llama a la red real) y agregar el caso del switch nuevo
   donde aplique (`payment-gateway-resolver.service.spec.ts`,
   `charge-payment.service.spec.ts` si corresponde).
10. **Doc**: un doc nuevo especifico del proveedor (como doc 21/22), sin
    tocar esta doc salvo que el patron general cambie.

## Como probar todo localmente

- **Solo la arquitectura** (sin credenciales de ningun proveedor real): el
  test `payment-gateway-registry.service.spec.ts` (seccion 3 arriba) y
  `charge-payment.service.spec.ts` (el test "STAFF_OFFLINE nunca invoca al
  resolver" en particular) se corren con `npm run test`, sin DB ni red.
- **Mercado Pago**: doc 21, seccion "Como probar todo localmente".
- **Transbank**: doc 22, seccion "Como probar en vivo", incluye los codigos
  de integracion publicos que Transbank pre-carga en el SDK para probar sin
  afiliarse.
- **Ambos conectados al mismo tiempo**: conecta las dos cuentas del mismo
  restaurante (Mercado Pago via OAuth, Transbank manual) y confirma en
  `GET .../payment-config` que `options` trae ambas, ordenadas por
  `displayPriority`; usa `PATCH .../:provider/preferred` para cambiar cual
  sale primero y confirma que `isPreferred` se mueve.

## Referencias

- `docs/24-pagos-vision-general.md` -- mapa de flujos de dinero, por que
  existen dos pasarelas, que esta activo por configuracion y la matriz de
  capacidad flujo x proveedor (incluye el gap de split bill + Transbank)
- `src/modules/payments/README.md` -- detalle linea a linea de endpoints y
  del modulo
- `docs/21-mercado-pago-integracion.md` -- especifico de Mercado Pago
- `docs/22-transbank-webpay-integracion.md` -- especifico de Transbank
- `src/modules/payments/domain/payment-gateway-adapter.decorator.ts`,
  `src/modules/payments/infrastructure/payment-gateway-registry.service.ts`
  -- codigo del patron de discovery
- `src/modules/payments/application/ports/payment-gateway.port.ts` -- el
  puerto discriminado
- `sazono-ui/docs/19-transbank-y-checkout-multi-proveedor.md` -- como el
  frontend consume `options[]` y arma el redirect
