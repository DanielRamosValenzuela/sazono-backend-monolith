# API Curl Examples

## Notas

- Base URL local versionada: `http://localhost:3000/api/v1`
- si cambias `PORT` o `API_PREFIX`, actualiza estos ejemplos
- si cambias la version, actualiza `v1`
- para endpoints protegidos usa `Bearer <TOKEN>`

## Auth login

```bash
curl --request POST "http://localhost:3000/api/v1/auth/login" \
  --header "Content-Type: application/json" \
  --data '{
    "email": "platform-admin@sazono.cl",
    "password": "ChangeMe123!",
    "profileType": "PLATFORM_ADMIN"
  }'
```

## Auth me

```bash
curl --request GET "http://localhost:3000/api/v1/auth/me" \
  --header "Authorization: Bearer <TOKEN>"
```

## Restaurants bootstrap

```bash
curl --request POST "http://localhost:3000/api/v1/restaurants/bootstrap" \
  --header "Authorization: Bearer <TOKEN>" \
  --header "Content-Type: application/json" \
  --data '{
    "restaurant": {
      "name": "Sazono Demo Providencia",
      "legalName": "Sazono Demo SpA",
      "defaultLanguage": "es",
      "timezone": "America/Santiago",
      "currency": "CLP"
    },
    "admin": {
      "email": "admin@sazonodemo.cl",
      "password": "Sazono1234!",
      "firstName": "Daniel",
      "lastName": "Perez"
    }
  }'
```

## Respuesta esperada del bootstrap

```json
{
  "restaurantId": "uuid",
  "restaurantName": "Sazono Demo Providencia",
  "firstAdmin": {
    "authUserId": "uuid",
    "staffUserId": "uuid",
    "email": "admin@sazonodemo.cl",
    "firstName": "Daniel",
    "lastName": "Perez"
  }
}
```

## Branches create

```bash
curl --request POST "http://localhost:3000/api/v1/branches" \
  --header "Authorization: Bearer <TOKEN_STAFF>" \
  --header "Content-Type: application/json" \
  --data '{
    "name": "Providencia",
    "address": "Av. Providencia 1234, Santiago",
    "settings": {
      "qrOrderingEnabled": true,
      "qrPaymentMode": "prepaid_order",
      "splitBillEnabled": true,
      "partialDeliveryEnabled": true
    }
  }'
```

## Respuesta esperada de branch create

```json
{
  "branchId": "uuid",
  "restaurantId": "uuid",
  "name": "Providencia",
  "address": "Av. Providencia 1234, Santiago",
  "assignedRole": "ADMIN",
  "settings": {
    "qrOrderingEnabled": true,
    "qrPaymentMode": "prepaid_order",
    "splitBillEnabled": true,
    "partialDeliveryEnabled": true
  }
}
```

## Staff list

```bash
curl --request GET "http://localhost:3000/api/v1/staff" \
  --header "Authorization: Bearer <TOKEN_STAFF_ADMIN>"
```

## Respuesta esperada de staff list

```json
[
  {
    "staffUserId": "uuid",
    "authUserId": "uuid",
    "restaurantId": "uuid",
    "email": "admin@sazonodemo.cl",
    "firstName": "Daniel",
    "lastName": "Perez",
    "status": "ACTIVE",
    "branchRoles": [
      {
        "branchId": "uuid",
        "branchName": "Providencia",
        "role": "ADMIN"
      }
    ]
  }
]
```

## Staff create

```bash
curl --request POST "http://localhost:3000/api/v1/staff" \
  --header "Authorization: Bearer <TOKEN_STAFF_ADMIN>" \
  --header "Content-Type: application/json" \
  --data '{
    "email": "ana@sazonodemo.cl",
    "password": "Temporal123!",
    "firstName": "Ana",
    "lastName": "Diaz",
    "branchRoles": [
      {
        "branchId": "<BRANCH_ID>",
        "role": "WAITER"
      }
    ]
  }'
```

## Respuesta esperada de staff create

```json
{
  "staffUserId": "uuid",
  "authUserId": "uuid",
  "restaurantId": "uuid",
  "email": "ana@sazonodemo.cl",
  "firstName": "Ana",
  "lastName": "Diaz",
  "status": "ACTIVE",
  "branchRoles": [
    {
      "branchId": "uuid",
      "branchName": "Providencia",
      "role": "WAITER"
    }
  ]
}
```

## Floor create table

```bash
curl --request POST "http://localhost:3000/api/v1/floor/tables" \
  --header "Authorization: Bearer <TOKEN_STAFF_ADMIN_OR_SUPERVISOR>" \
  --header "Content-Type: application/json" \
  --data '{
    "branchId": "<BRANCH_ID>",
    "code": "M01",
    "name": "Mesa terraza 1",
    "capacity": 4
  }'
```

## Respuesta esperada de floor create table

```json
{
  "tableId": "uuid",
  "branchId": "uuid",
  "code": "M01",
  "name": "Mesa terraza 1",
  "capacity": 4,
  "status": "AVAILABLE",
  "qrToken": "uuid",
  "currentSession": null
}
```

## Floor list tables

```bash
curl --request GET "http://localhost:3000/api/v1/floor/tables?branchId=<BRANCH_ID>" \
  --header "Authorization: Bearer <TOKEN_STAFF>"
```

## Respuesta esperada de floor list tables

```json
[
  {
    "tableId": "uuid",
    "branchId": "uuid",
    "code": "M01",
    "name": "Mesa terraza 1",
    "capacity": 4,
    "status": "OCCUPIED",
    "qrToken": "uuid",
    "currentSession": {
      "tableSessionId": "uuid",
      "status": "OPEN",
      "openedBySource": "WAITER",
      "openedAt": "2026-07-03T12:00:00.000Z"
    }
  }
]
```

## Floor open table session

```bash
curl --request POST "http://localhost:3000/api/v1/floor/table-sessions/open" \
  --header "Authorization: Bearer <TOKEN_STAFF>" \
  --header "Content-Type: application/json" \
  --data '{
    "tableId": "<TABLE_ID>",
    "openedBySource": "WAITER"
  }'
```

## Respuesta esperada de floor open table session

```json
{
  "tableSessionId": "uuid",
  "tableId": "uuid",
  "branchId": "uuid",
  "status": "OPEN",
  "openedBySource": "WAITER",
  "openedAt": "2026-07-03T12:00:00.000Z",
  "closeReason": null,
  "closedAt": null
}
```

## Floor get current table session

```bash
curl --request GET "http://localhost:3000/api/v1/floor/tables/<TABLE_ID>/current-session" \
  --header "Authorization: Bearer <TOKEN_STAFF>"
```

## Respuesta esperada de floor get current table session

```json
{
  "tableSessionId": "uuid",
  "tableId": "uuid",
  "branchId": "uuid",
  "status": "OPEN",
  "openedBySource": "WAITER",
  "openedAt": "2026-07-03T12:00:00.000Z",
  "closeReason": null,
  "closedAt": null
}
```

## Billing get current bill

```bash
curl --request GET "http://localhost:3000/api/v1/billing/table-sessions/<TABLE_SESSION_ID>/current-bill" \
  --header "Authorization: Bearer <TOKEN_STAFF>"
```

## Respuesta esperada de billing get current bill

```json
{
  "billId": "uuid",
  "tableSessionId": "uuid",
  "branchId": "uuid",
  "status": "OPEN",
  "subtotalAmount": "0",
  "taxAmount": "0",
  "tipAmount": "0",
  "totalAmount": "0",
  "remainingAmount": "0",
  "openedAt": "2026-07-03T12:00:00.000Z",
  "closedAt": null,
  "closeReason": null
}
```

## Floor close table session

```bash
curl --request POST "http://localhost:3000/api/v1/floor/table-sessions/<TABLE_SESSION_ID>/close" \
  --header "Authorization: Bearer <TOKEN_STAFF>" \
  --header "Content-Type: application/json" \
  --data '{
    "closeReason": "Cuenta cerrada manualmente por caja."
  }'
```

## Respuesta esperada de floor close table session

```json
{
  "tableSessionId": "uuid",
  "tableId": "uuid",
  "branchId": "uuid",
  "status": "CLOSED",
  "openedBySource": "WAITER",
  "openedAt": "2026-07-03T12:00:00.000Z",
  "closeReason": "Cuenta cerrada manualmente por caja.",
  "closedAt": "2026-07-03T13:00:00.000Z"
}
```

## Menus create preparation station

```bash
curl --request POST "http://localhost:3000/api/v1/menus/preparation-stations" \
  --header "Authorization: Bearer <TOKEN_STAFF_ADMIN>" \
  --header "Content-Type: application/json" \
  --data '{
    "branchId": "<BRANCH_ID>",
    "name": "Barra principal",
    "stationType": "BAR"
  }'
```

## Menus list preparation stations

```bash
curl --request GET "http://localhost:3000/api/v1/menus/preparation-stations?branchId=<BRANCH_ID>" \
  --header "Authorization: Bearer <TOKEN_STAFF_ADMIN>"
```

## Menus create draft menu

```bash
curl --request POST "http://localhost:3000/api/v1/menus" \
  --header "Authorization: Bearer <TOKEN_STAFF_ADMIN>" \
  --header "Content-Type: application/json" \
  --data '{
    "branchId": "<BRANCH_ID>",
    "name": "Carta invierno 2026",
    "defaultLanguage": "es"
  }'
```

## Respuesta esperada de menus create draft menu

```json
{
  "menuId": "uuid",
  "branchId": "uuid",
  "name": "Carta invierno 2026",
  "status": "DRAFT",
  "version": 1,
  "defaultLanguage": "es",
  "publishedAt": null,
  "isDefaultMenu": false,
  "categoryCount": 0,
  "itemCount": 0
}
```

## Menus create category

```bash
curl --request POST "http://localhost:3000/api/v1/menus/<MENU_ID>/categories" \
  --header "Authorization: Bearer <TOKEN_STAFF_ADMIN>" \
  --header "Content-Type: application/json" \
  --data '{
    "name": "Cocteles",
    "sortOrder": 0
  }'
```

## Menus create item

```bash
curl --request POST "http://localhost:3000/api/v1/menus/categories/<MENU_CATEGORY_ID>/items" \
  --header "Authorization: Bearer <TOKEN_STAFF_ADMIN>" \
  --header "Content-Type: application/json" \
  --data '{
    "name": "Pisco Sour",
    "description": "Pisco, limon y goma.",
    "price": "5900",
    "itemType": "DRINK",
    "preparationStationId": "<PREPARATION_STATION_ID>",
    "isAvailable": true
  }'
```

## Menus get detail

```bash
curl --request GET "http://localhost:3000/api/v1/menus/<MENU_ID>" \
  --header "Authorization: Bearer <TOKEN_STAFF_ADMIN>"
```

## Menus publish menu

```bash
curl --request POST "http://localhost:3000/api/v1/menus/<MENU_ID>/publish" \
  --header "Authorization: Bearer <TOKEN_STAFF_ADMIN>"
```

## QR get published menu (publico)

```bash
curl --request GET "http://localhost:3000/api/v1/qr/tables/<QR_TOKEN>/menu"
```

## QR create prepaid order (publico)

```bash
curl --request POST "http://localhost:3000/api/v1/qr/tables/<QR_TOKEN>/orders" \
  --header "Content-Type: application/json" \
  --data '{
    "items": [
      {
        "menuItemId": "<MENU_ITEM_ID>",
        "quantity": 2,
        "notes": "Sin hielo."
      }
    ],
    "notes": "Pedido desde la mesa."
  }'
```

## Respuesta esperada de QR create prepaid order

```json
{
  "orderId": "uuid",
  "tableSessionId": "uuid",
  "billId": "uuid",
  "branchId": "uuid",
  "source": "QR",
  "paymentPolicy": "PREPAID",
  "status": "AWAITING_PAYMENT",
  "notes": "Pedido desde la mesa.",
  "submittedAt": "2026-07-07T12:00:00.000Z",
  "createdAt": "2026-07-07T12:00:00.000Z",
  "orderTotalAmount": "11800",
  "items": [
    {
      "orderItemId": "uuid",
      "menuItemId": "uuid",
      "name": "Pisco Sour",
      "unitPrice": "5900",
      "quantity": 2,
      "totalPrice": "11800",
      "status": "PENDING",
      "notes": "Sin hielo.",
      "preparationStation": {
        "preparationStationId": "uuid",
        "name": "Barra principal",
        "stationType": "BAR",
        "status": "ACTIVE"
      }
    }
  ],
  "stationTickets": []
}
```

## QR list session orders (publico)

```bash
curl --request GET "http://localhost:3000/api/v1/qr/tables/<QR_TOKEN>/orders"
```

## Orders create waiter order

```bash
curl --request POST "http://localhost:3000/api/v1/orders" \
  --header "Authorization: Bearer <TOKEN_STAFF>" \
  --header "Content-Type: application/json" \
  --data '{
    "tableSessionId": "<TABLE_SESSION_ID>",
    "items": [
      {
        "menuItemId": "<MENU_ITEM_ID>",
        "quantity": 1,
        "notes": "Sin cebolla."
      }
    ],
    "notes": "Ronda dos."
  }'
```

## Respuesta esperada de orders create waiter order

```json
{
  "orderId": "uuid",
  "tableSessionId": "uuid",
  "billId": "uuid",
  "branchId": "uuid",
  "source": "WAITER",
  "paymentPolicy": "POSTPAID",
  "status": "ROUTED",
  "notes": "Ronda dos.",
  "submittedAt": "2026-07-07T12:00:00.000Z",
  "createdAt": "2026-07-07T12:00:00.000Z",
  "orderTotalAmount": "11900",
  "items": [
    {
      "orderItemId": "uuid",
      "menuItemId": "uuid",
      "name": "Lomo saltado",
      "unitPrice": "11900",
      "quantity": 1,
      "totalPrice": "11900",
      "status": "PENDING",
      "notes": "Sin cebolla.",
      "preparationStation": {
        "preparationStationId": "uuid",
        "name": "Cocina caliente",
        "stationType": "KITCHEN",
        "status": "ACTIVE"
      }
    }
  ],
  "stationTickets": [
    {
      "stationTicketId": "uuid",
      "preparationStationId": "uuid",
      "stationName": "Cocina caliente",
      "stationType": "KITCHEN",
      "status": "PENDING",
      "sentAt": "2026-07-07T12:00:00.000Z"
    }
  ]
}
```

## Orders list by table session

```bash
curl --request GET "http://localhost:3000/api/v1/orders?tableSessionId=<TABLE_SESSION_ID>" \
  --header "Authorization: Bearer <TOKEN_STAFF>"
```

## Orders get detail

```bash
curl --request GET "http://localhost:3000/api/v1/orders/<ORDER_ID>" \
  --header "Authorization: Bearer <TOKEN_STAFF>"
```

## Kitchen list station tickets

```bash
curl --request GET "http://localhost:3000/api/v1/kitchen/station-tickets?branchId=<BRANCH_ID>&preparationStationId=<PREPARATION_STATION_ID>&status=PENDING" \
  --header "Authorization: Bearer <TOKEN_STAFF_KITCHEN>"
```

## Kitchen update station ticket status

```bash
curl --request POST "http://localhost:3000/api/v1/kitchen/station-tickets/<STATION_TICKET_ID>/status" \
  --header "Authorization: Bearer <TOKEN_STAFF_KITCHEN>" \
  --header "Content-Type: application/json" \
  --data '{
    "status": "IN_PROGRESS"
  }'
```

## Respuesta esperada de kitchen update station ticket status

```json
{
  "stationTicketId": "uuid",
  "orderId": "uuid",
  "branchId": "uuid",
  "preparationStationId": "uuid",
  "stationName": "Cocina caliente",
  "stationType": "KITCHEN",
  "status": "IN_PROGRESS",
  "orderSource": "WAITER",
  "tableCode": "M01",
  "orderNotes": "Ronda dos.",
  "sentAt": "2026-07-07T12:00:00.000Z",
  "startedAt": "2026-07-07T12:05:00.000Z",
  "completedAt": null,
  "items": [
    {
      "stationTicketItemId": "uuid",
      "orderItemId": "uuid",
      "name": "Lomo saltado",
      "quantity": 1,
      "status": "IN_PREPARATION",
      "notes": "Sin cebolla."
    }
  ]
}
```

## Respuesta esperada de menus publish menu

```json
{
  "menuId": "uuid",
  "branchId": "uuid",
  "name": "Carta invierno 2026",
  "status": "PUBLISHED",
  "version": 1,
  "defaultLanguage": "es",
  "publishedAt": "2026-07-07T12:00:00.000Z",
  "isDefaultMenu": true,
  "categories": [
    {
      "menuCategoryId": "uuid",
      "name": "Cocteles",
      "sortOrder": 0,
      "status": "ACTIVE",
      "items": [
        {
          "menuItemId": "uuid",
          "name": "Pisco Sour",
          "description": "Pisco, limon y goma.",
          "price": "5900",
          "sku": null,
          "itemType": "DRINK",
          "isAvailable": true,
          "preparationStation": {
            "preparationStationId": "uuid",
            "name": "Barra principal",
            "stationType": "BAR",
            "status": "ACTIVE"
          }
        }
      ]
    }
  ]
}
```
