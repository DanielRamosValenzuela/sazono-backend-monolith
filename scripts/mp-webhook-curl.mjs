// Genera un comando curl firmado para probar POST /api/v1/webhooks/payments/mercado-pago
// contra un backend local. Usa el mismo manifest y algoritmo HMAC-SHA256 que
// src/modules/payments/infrastructure/mercado-pago/mercado-pago-signature.verifier.ts
// y la doc oficial:
// https://www.mercadopago.com.ar/developers/en/docs/your-integrations/notifications/webhooks
//
// Uso:
//   MERCADOPAGO_WEBHOOK_SECRET=tu-secreto node scripts/mp-webhook-curl.mjs [dataId] [baseUrl]
//
// Ejemplo:
//   MERCADOPAGO_WEBHOOK_SECRET=test-secret node scripts/mp-webhook-curl.mjs 999999999 http://localhost:5000

import { createHmac, randomUUID } from 'node:crypto';

const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;

if (!secret) {
  console.error('Falta MERCADOPAGO_WEBHOOK_SECRET en el entorno.');
  process.exit(1);
}

const dataId = process.argv[2] ?? '999999999';
const baseUrl = process.argv[3] ?? 'http://localhost:5000';
const requestId = randomUUID();
const ts = Math.floor(Date.now() / 1000);
const normalizedDataId = /^[a-zA-Z0-9]+$/.test(dataId)
  ? dataId.toLowerCase()
  : dataId;
const manifest = `id:${normalizedDataId};request-id:${requestId};ts:${ts};`;
const v1 = createHmac('sha256', secret).update(manifest).digest('hex');

const body = JSON.stringify({
  id: Date.now(),
  live_mode: false,
  type: 'payment',
  action: 'payment.updated',
  api_version: 'v1',
  user_id: 44444,
  data: { id: dataId },
});

const url = `${baseUrl}/api/v1/webhooks/payments/mercado-pago?data.id=${encodeURIComponent(dataId)}&type=payment`;

const command = [
  'curl -i -X POST',
  `"${url}"`,
  '-H "Content-Type: application/json"',
  `-H "x-request-id: ${requestId}"`,
  `-H "x-signature: ts=${ts},v1=${v1}"`,
  `-d '${body}'`,
].join(' \\\n  ');

console.log(command);
