export const TRANSBANK_PROVIDER_NAME = 'TRANSBANK';

export const TRANSBANK_WEBPAY_STATUS_DOCS_URL =
  'https://www.transbankdevelopers.cl/referencia/webpay#webpay-plus-mall-confirmar-transaccion';

export type TransbankOutcome = 'APPROVED' | 'REJECTED';

export type TransbankStatusMapping = {
  outcome: TransbankOutcome;
  failureReason?: string;
};

const APPROVED_STATUS = 'AUTHORIZED';
const APPROVED_RESPONSE_CODE = 0;

const GENERIC_REJECTED_MESSAGE =
  'El medio de pago rechazo el cobro, intenta con otro.';

export function mapTransbankStatus(
  status: string,
  responseCode: number,
): TransbankStatusMapping {
  if (status === APPROVED_STATUS && responseCode === APPROVED_RESPONSE_CODE) {
    return { outcome: 'APPROVED' };
  }

  return { outcome: 'REJECTED', failureReason: GENERIC_REJECTED_MESSAGE };
}
