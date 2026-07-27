import { createHmac } from 'node:crypto';
import { MercadoPagoSignatureVerifier } from './mercado-pago-signature.verifier';
import type { MercadoPagoConfigService } from './mercado-pago-config.service';

const WEBHOOK_SECRET = 'test-webhook-secret';

function signManifest(manifest: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(manifest).digest('hex');
}

function buildXSignature(input: {
  ts: string;
  dataId?: string;
  xRequestId?: string;
}): string {
  const segments: string[] = [];

  if (input.dataId) {
    segments.push(`id:${input.dataId.toLowerCase()};`);
  }

  if (input.xRequestId) {
    segments.push(`request-id:${input.xRequestId};`);
  }

  segments.push(`ts:${input.ts};`);

  const v1 = signManifest(segments.join(''));

  return `ts=${input.ts},v1=${v1}`;
}

describe('MercadoPagoSignatureVerifier', () => {
  let mercadoPagoConfig: MercadoPagoConfigService;
  let verifier: MercadoPagoSignatureVerifier;
  const now = new Date('2026-07-27T12:00:00.000Z');
  const nowSeconds = Math.floor(now.getTime() / 1000);

  beforeEach(() => {
    mercadoPagoConfig = {
      webhookSecret: WEBHOOK_SECRET,
      webhookToleranceSeconds: 300,
    } as unknown as MercadoPagoConfigService;
    verifier = new MercadoPagoSignatureVerifier(mercadoPagoConfig);
  });

  it('accepts a correctly signed notification', () => {
    const xSignature = buildXSignature({
      ts: String(nowSeconds),
      dataId: '999999999',
      xRequestId: 'request-1',
    });

    const result = verifier.verify({
      xSignature,
      xRequestId: 'request-1',
      dataId: '999999999',
      now,
    });

    expect(result).toEqual({ valid: true });
  });

  it('normalizes an alphanumeric data.id to lowercase before signing', () => {
    const xSignature = buildXSignature({
      ts: String(nowSeconds),
      dataId: 'ord01jq4s4ky8hwq6na5pxb65b3d3',
      xRequestId: 'request-1',
    });

    const result = verifier.verify({
      xSignature,
      xRequestId: 'request-1',
      dataId: 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3',
      now,
    });

    expect(result).toEqual({ valid: true });
  });

  it('drops the request-id segment from the manifest when the header is missing', () => {
    const xSignature = buildXSignature({
      ts: String(nowSeconds),
      dataId: '999999999',
    });

    const result = verifier.verify({
      xSignature,
      xRequestId: undefined,
      dataId: '999999999',
      now,
    });

    expect(result).toEqual({ valid: true });
  });

  it('rejects when the x-signature header is missing', () => {
    const result = verifier.verify({
      xSignature: undefined,
      xRequestId: 'request-1',
      dataId: '999999999',
      now,
    });

    expect(result).toEqual({ valid: false, reason: 'MISSING_SIGNATURE' });
  });

  it('rejects a malformed x-signature header without ts or v1', () => {
    const result = verifier.verify({
      xSignature: 'not-a-valid-header',
      xRequestId: 'request-1',
      dataId: '999999999',
      now,
    });

    expect(result).toEqual({ valid: false, reason: 'MALFORMED_SIGNATURE' });
  });

  it('rejects when v1 is not valid hex', () => {
    const result = verifier.verify({
      xSignature: `ts=${nowSeconds},v1=not-hex-zzz`,
      xRequestId: 'request-1',
      dataId: '999999999',
      now,
    });

    expect(result).toEqual({ valid: false, reason: 'MALFORMED_SIGNATURE' });
  });

  it('rejects when v1 does not match the recomputed HMAC', () => {
    const xSignature = buildXSignature({
      ts: String(nowSeconds),
      dataId: '999999999',
      xRequestId: 'request-1',
    });
    const tamperedSignature = xSignature.replace(
      /v1=[0-9a-f]+/,
      (match) => match.slice(0, -1) + (match.endsWith('0') ? '1' : '0'),
    );

    const result = verifier.verify({
      xSignature: tamperedSignature,
      xRequestId: 'request-1',
      dataId: '999999999',
      now,
    });

    expect(result).toEqual({ valid: false, reason: 'SIGNATURE_MISMATCH' });
  });

  it('rejects a timestamp older than the tolerance window', () => {
    const staleTs = nowSeconds - 600;
    const xSignature = buildXSignature({
      ts: String(staleTs),
      dataId: '999999999',
      xRequestId: 'request-1',
    });

    const result = verifier.verify({
      xSignature,
      xRequestId: 'request-1',
      dataId: '999999999',
      now,
    });

    expect(result).toEqual({
      valid: false,
      reason: 'TIMESTAMP_OUT_OF_WINDOW',
    });
  });

  it('rejects a timestamp further in the future than the tolerance window', () => {
    const futureTs = nowSeconds + 600;
    const xSignature = buildXSignature({
      ts: String(futureTs),
      dataId: '999999999',
      xRequestId: 'request-1',
    });

    const result = verifier.verify({
      xSignature,
      xRequestId: 'request-1',
      dataId: '999999999',
      now,
    });

    expect(result).toEqual({
      valid: false,
      reason: 'TIMESTAMP_OUT_OF_WINDOW',
    });
  });

  it('normalizes a millisecond ts before applying the tolerance window', () => {
    const xSignature = buildXSignature({
      ts: String(now.getTime()),
      dataId: '999999999',
      xRequestId: 'request-1',
    });

    const result = verifier.verify({
      xSignature,
      xRequestId: 'request-1',
      dataId: '999999999',
      now,
    });

    expect(result).toEqual({ valid: true });
  });

  it('rejects when the webhook secret is not configured', () => {
    mercadoPagoConfig = {
      get webhookSecret(): string {
        throw new Error('Mercado Pago no esta configurado.');
      },
      webhookToleranceSeconds: 300,
    } as unknown as MercadoPagoConfigService;
    verifier = new MercadoPagoSignatureVerifier(mercadoPagoConfig);

    const xSignature = buildXSignature({
      ts: String(nowSeconds),
      dataId: '999999999',
      xRequestId: 'request-1',
    });

    const result = verifier.verify({
      xSignature,
      xRequestId: 'request-1',
      dataId: '999999999',
      now,
    });

    expect(result).toEqual({ valid: false, reason: 'SECRET_NOT_CONFIGURED' });
  });
});
