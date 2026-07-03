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
