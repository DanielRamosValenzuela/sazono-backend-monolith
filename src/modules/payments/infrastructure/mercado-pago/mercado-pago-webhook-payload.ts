export interface MercadoPagoWebhookNotification {
  id?: unknown;
  live_mode?: unknown;
  type?: unknown;
  action?: unknown;
  date_created?: unknown;
  user_id?: unknown;
  api_version?: unknown;
  data?: { id?: unknown } | unknown;
}

export function readWebhookEventId(
  body: MercadoPagoWebhookNotification | undefined,
): string | null {
  return readNonEmptyStringOrNumber(body?.id);
}

export function readWebhookType(
  body: MercadoPagoWebhookNotification | undefined,
): string {
  return typeof body?.type === 'string' && body.type.trim().length > 0
    ? body.type.trim()
    : 'unknown';
}

export function readWebhookDataId(
  body: MercadoPagoWebhookNotification | undefined,
): string | null {
  const data = body?.data;

  if (!data || typeof data !== 'object') {
    return null;
  }

  return readNonEmptyStringOrNumber((data as { id?: unknown }).id);
}

export function readWebhookUserId(
  body: MercadoPagoWebhookNotification | undefined,
): string | null {
  return readNonEmptyStringOrNumber(body?.user_id);
}

function readNonEmptyStringOrNumber(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return null;
}
