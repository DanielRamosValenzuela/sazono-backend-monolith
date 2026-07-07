import type { Prisma } from '@prisma/client';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export type PaymentChargeInput = {
  amount: Prisma.Decimal;
  currency: string;
  description: string;
};

export type PaymentChargeResult = {
  approved: boolean;
  providerReference?: string;
  failureReason?: string;
};

/**
 * Puerto de cobro inmediato contra el proveedor de pagos.
 *
 * El MVP usa un adapter manual que aprueba en el momento (pago en caja o
 * provider simulado). La integracion real con una pasarela (Webpay,
 * MercadoPago, Stripe, etc.) debe implementarse como un nuevo adapter de
 * este puerto sin tocar los casos de uso.
 */
export interface PaymentProviderPort {
  readonly providerName: string;

  charge(input: PaymentChargeInput): Promise<PaymentChargeResult>;
}
