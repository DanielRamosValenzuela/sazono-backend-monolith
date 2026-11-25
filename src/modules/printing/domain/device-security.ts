import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { PrintDeviceKind, PrinterTransport } from '@prisma/client';

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashPairingCode(code: string, secret: string): string {
  return createHmac('sha256', secret).update(code).digest('hex');
}

export function generateDeviceToken(): string {
  return randomBytes(32).toString('base64url');
}

export function generatePairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function parseDeviceAuthorization(
  header: string | undefined,
): string | null {
  if (!header) {
    return null;
  }

  const match = /^Device\s+(\S{20,200})$/.exec(header.trim());

  return match ? match[1] : null;
}

const SERVED_TRANSPORTS: Record<PrintDeviceKind, PrinterTransport[]> = {
  [PrintDeviceKind.ANDROID_APP]: [
    PrinterTransport.APP_BRIDGE,
    PrinterTransport.BROWSER,
  ],
  [PrintDeviceKind.BROWSER]: [PrinterTransport.BROWSER],
  [PrintDeviceKind.AGENT]: [PrinterTransport.AGENT],
};

export function transportsServedBy(kind: PrintDeviceKind): PrinterTransport[] {
  return SERVED_TRANSPORTS[kind];
}
