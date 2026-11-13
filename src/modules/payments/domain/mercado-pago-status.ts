export const MERCADOPAGO_PROVIDER_NAME = 'MERCADO_PAGO';

export const MERCADOPAGO_PAYMENT_STATUS_DOCS_URL =
  'https://www.mercadopago.com.ar/developers/en/docs/checkout-api/response-handling/collection-results';

export type MercadoPagoOutcome = 'APPROVED' | 'PENDING' | 'REJECTED';

export type MercadoPagoStatusMapping = {
  outcome: MercadoPagoOutcome;
  failureReason?: string;
};

const APPROVED_STATUSES = new Set(['approved']);
const PENDING_STATUSES = new Set(['pending', 'in_process', 'authorized']);

const STATUS_DETAIL_MESSAGES: Record<string, string> = {
  cc_rejected_insufficient_amount: 'La tarjeta no tiene saldo suficiente.',
  cc_rejected_bad_filled_security_code:
    'El codigo de seguridad de la tarjeta es incorrecto.',
  cc_rejected_bad_filled_date:
    'La fecha de vencimiento de la tarjeta es incorrecta.',
  cc_rejected_bad_filled_other:
    'Revisa los datos de la tarjeta e intenta nuevamente.',
  cc_rejected_bad_filled_card_number: 'El numero de tarjeta es incorrecto.',
  cc_rejected_call_for_authorize:
    'Debes autorizar el pago con tu banco antes de reintentar.',
  cc_rejected_card_disabled:
    'La tarjeta esta deshabilitada, contacta a tu banco.',
  cc_rejected_duplicated_payment:
    'Ya existe un pago identico reciente con esta tarjeta.',
  cc_rejected_high_risk: 'El pago fue rechazado por prevencion de fraude.',
  cc_rejected_max_attempts:
    'Se alcanzo el limite de intentos permitidos con esta tarjeta.',
  cc_rejected_other_reason:
    'El medio de pago rechazo el cobro, intenta con otro.',
  cc_rejected_invalid_installments:
    'El numero de cuotas no es valido para esta tarjeta.',
  cc_rejected_blacklist:
    'El medio de pago no pudo procesarse, intenta con otro.',
};

const GENERIC_REJECTED_MESSAGE =
  'El medio de pago rechazo el cobro, intenta con otro.';
const GENERIC_PENDING_MESSAGE =
  'El pago quedo en revision, intenta con otro medio de pago.';

const ORDER_APPROVED_STATUSES = new Set(['processed']);
const ORDER_PENDING_STATUSES = new Set([
  'created',
  'processing',
  'action_required',
]);
const ORDER_REJECTED_STATUSES = new Set(['failed', 'canceled', 'expired']);
const ORDER_REVERSAL_MESSAGES: Record<string, string> = {
  refunded: 'El pago fue reembolsado.',
  charged_back: 'El pago fue objetado con un contracargo.',
};
const GENERIC_ORDER_UNKNOWN_MESSAGE =
  'El pago esta en un estado que requiere revision.';

export function mapMercadoPagoOrderStatus(
  status: string,
  statusDetail?: string,
): MercadoPagoStatusMapping {
  const normalizedStatus = status.toLowerCase();

  if (ORDER_APPROVED_STATUSES.has(normalizedStatus)) {
    return { outcome: 'APPROVED' };
  }

  if (ORDER_PENDING_STATUSES.has(normalizedStatus)) {
    return { outcome: 'PENDING', failureReason: GENERIC_PENDING_MESSAGE };
  }

  if (ORDER_REJECTED_STATUSES.has(normalizedStatus)) {
    return mapMercadoPagoStatus('rejected', statusDetail);
  }

  return {
    outcome: 'PENDING',
    failureReason:
      ORDER_REVERSAL_MESSAGES[normalizedStatus] ??
      GENERIC_ORDER_UNKNOWN_MESSAGE,
  };
}

export function mapMercadoPagoStatus(
  status: string,
  statusDetail?: string,
): MercadoPagoStatusMapping {
  const normalizedStatus = status.toLowerCase();

  if (APPROVED_STATUSES.has(normalizedStatus)) {
    return { outcome: 'APPROVED' };
  }

  if (PENDING_STATUSES.has(normalizedStatus)) {
    return { outcome: 'PENDING', failureReason: GENERIC_PENDING_MESSAGE };
  }

  const failureReason =
    (statusDetail ? STATUS_DETAIL_MESSAGES[statusDetail] : undefined) ??
    GENERIC_REJECTED_MESSAGE;

  return { outcome: 'REJECTED', failureReason };
}
