import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { MercadoPagoConfigService } from './mercado-pago-config.service';

export const MERCADOPAGO_WEBHOOK_SIGNATURE_DOCS_URL =
  'https://www.mercadopago.com.ar/developers/en/docs/your-integrations/notifications/webhooks';

export type MercadoPagoSignatureFailureReason =
  | 'MISSING_SIGNATURE'
  | 'MALFORMED_SIGNATURE'
  | 'INVALID_TIMESTAMP'
  | 'TIMESTAMP_OUT_OF_WINDOW'
  | 'SECRET_NOT_CONFIGURED'
  | 'SIGNATURE_MISMATCH';

export type MercadoPagoSignatureVerificationResult =
  { valid: true } | { valid: false; reason: MercadoPagoSignatureFailureReason };

export type MercadoPagoSignatureVerificationInput = {
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string | undefined;
  now?: Date;
};

const MILLISECOND_TIMESTAMP_THRESHOLD = 1e12;
const HEX_PATTERN = /^[0-9a-f]+$/i;
const ALPHANUMERIC_PATTERN = /^[a-zA-Z0-9]+$/;
const DIGITS_PATTERN = /^\d+$/;

type ParsedXSignature = {
  ts: string;
  v1: string;
};

@Injectable()
export class MercadoPagoSignatureVerifier {
  constructor(private readonly mercadoPagoConfig: MercadoPagoConfigService) {}

  verify(
    input: MercadoPagoSignatureVerificationInput,
  ): MercadoPagoSignatureVerificationResult {
    if (!input.xSignature) {
      return { valid: false, reason: 'MISSING_SIGNATURE' };
    }

    const parsed = parseXSignature(input.xSignature);

    if (!parsed || !HEX_PATTERN.test(parsed.v1) || parsed.v1.length % 2 !== 0) {
      return { valid: false, reason: 'MALFORMED_SIGNATURE' };
    }

    const timestampMs = normalizeTimestampToMs(parsed.ts);

    if (timestampMs === null) {
      return { valid: false, reason: 'INVALID_TIMESTAMP' };
    }

    const now = input.now ?? new Date();
    const toleranceMs = this.mercadoPagoConfig.webhookToleranceSeconds * 1000;

    if (Math.abs(now.getTime() - timestampMs) > toleranceMs) {
      return { valid: false, reason: 'TIMESTAMP_OUT_OF_WINDOW' };
    }

    let secret: string;

    try {
      secret = this.mercadoPagoConfig.webhookSecret;
    } catch {
      return { valid: false, reason: 'SECRET_NOT_CONFIGURED' };
    }

    const manifest = buildSignatureManifest({
      dataId: input.dataId,
      xRequestId: input.xRequestId,
      ts: parsed.ts,
    });
    const expectedHex = createHmac('sha256', secret)
      .update(manifest)
      .digest('hex');

    if (!isSignatureMatch(expectedHex, parsed.v1)) {
      return { valid: false, reason: 'SIGNATURE_MISMATCH' };
    }

    return { valid: true };
  }
}

function parseXSignature(header: string): ParsedXSignature | null {
  let ts: string | undefined;
  let v1: string | undefined;

  for (const rawPart of header.split(',')) {
    const separatorIndex = rawPart.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = rawPart.slice(0, separatorIndex).trim();
    const value = rawPart.slice(separatorIndex + 1).trim();

    if (key === 'ts' && value.length > 0) {
      ts = value;
    }

    if (key === 'v1' && value.length > 0) {
      v1 = value;
    }
  }

  if (!ts || !v1) {
    return null;
  }

  return { ts, v1 };
}

function normalizeTimestampToMs(ts: string): number | null {
  if (!DIGITS_PATTERN.test(ts)) {
    return null;
  }

  const numeric = Number(ts);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return numeric >= MILLISECOND_TIMESTAMP_THRESHOLD ? numeric : numeric * 1000;
}

function buildSignatureManifest(input: {
  dataId: string | undefined;
  xRequestId: string | undefined;
  ts: string;
}): string {
  const segments: string[] = [];

  if (input.dataId) {
    const normalizedDataId = ALPHANUMERIC_PATTERN.test(input.dataId)
      ? input.dataId.toLowerCase()
      : input.dataId;

    segments.push(`id:${normalizedDataId};`);
  }

  if (input.xRequestId) {
    segments.push(`request-id:${input.xRequestId};`);
  }

  segments.push(`ts:${input.ts};`);

  return segments.join('');
}

function isSignatureMatch(expectedHex: string, providedHex: string): boolean {
  if (expectedHex.length !== providedHex.length) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedHex, 'hex');
  const providedBuffer = Buffer.from(providedHex.toLowerCase(), 'hex');

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
