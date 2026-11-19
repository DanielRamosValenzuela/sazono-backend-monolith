import type { ProviderFailure } from '../../application/ports/tax-document-provider.port';

export const NETWORK_STATUS = 0;
export const IDEMPOTENCY_REPLAY_CODE = 'OF-06';
const MAX_MESSAGE_LENGTH = 500;

export type ApiResponse = { status: number; body: unknown };
export type CallContext = 'EMIT' | 'STATUS' | 'OTHER';

type ErrorDetail = { field?: unknown; issue?: unknown };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readErrorCode(body: unknown): string | null {
  const error = asRecord(asRecord(body)?.error);

  return typeof error?.code === 'string' ? error.code : null;
}

export function readErrorDetails(body: unknown): ErrorDetail[] {
  const details = asRecord(asRecord(body)?.error)?.details;

  return Array.isArray(details) ? (details as ErrorDetail[]) : [];
}

export function readReplayToken(body: unknown): string | null {
  const detail = readErrorDetails(body).find(
    (entry) => entry.field === 'token' && typeof entry.issue === 'string',
  );

  return detail ? (detail.issue as string) : null;
}

export function describeError(body: unknown): string {
  const record = asRecord(body);
  const error = asRecord(record?.error);
  const base =
    (typeof error?.message === 'string' && error.message) ||
    (typeof record?.message === 'string' && record.message) ||
    'Respuesta inesperada del proveedor.';
  const details = readErrorDetails(body)
    .map((entry) =>
      typeof entry.field === 'string' && typeof entry.issue === 'string'
        ? `${entry.field}: ${entry.issue}`
        : null,
    )
    .filter((entry): entry is string => entry !== null);
  const code = readErrorCode(body);
  const full = [code ? `[${code}]` : null, base, ...details]
    .filter(Boolean)
    .join(' - ');

  return full.slice(0, MAX_MESSAGE_LENGTH);
}

export function parseRetryAfterMs(body: unknown): number | null {
  const message = asRecord(body)?.message;

  if (typeof message !== 'string') {
    return null;
  }

  const match = /(\d+)\s*second/i.exec(message);

  return match ? Number(match[1]) * 1000 : null;
}

export function classifyFailure(
  response: ApiResponse,
  context: CallContext,
): ProviderFailure {
  const message = describeError(response.body);
  const code = readErrorCode(response.body);
  const retryable = (
    codeLabel: string,
    auth = false,
    retryAfterMs: number | null = null,
  ): ProviderFailure => ({
    retryable: true,
    code: codeLabel,
    message,
    auth,
    retryAfterMs,
  });

  if (response.status === NETWORK_STATUS) {
    return retryable('NETWORK');
  }

  if (response.status === 429) {
    return retryable('RATE_LIMITED', false, parseRetryAfterMs(response.body));
  }

  if (response.status === 401 || response.status === 403) {
    return retryable(code ?? 'AUTH', true);
  }

  if (response.status >= 500) {
    return retryable(code ?? `HTTP_${response.status}`);
  }

  if (code === 'OF-22') {
    return retryable(code);
  }

  if (response.status === 404 && context === 'STATUS') {
    return retryable('NOT_FOUND');
  }

  return {
    retryable: false,
    code: code ?? `HTTP_${response.status}`,
    message,
    auth: false,
    retryAfterMs: null,
  };
}
