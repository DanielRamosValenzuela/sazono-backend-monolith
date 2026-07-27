import type { PaymentGatewayPort } from './payment-gateway.port';

export const PAYMENT_GATEWAY_RESOLVER = Symbol('PAYMENT_GATEWAY_RESOLVER');

export type ResolvedPaymentGateway = {
  gateway: PaymentGatewayPort;
  accountId: string;
  publicKey: string | null;
  environment: string;
};

export interface PaymentGatewayResolverPort {
  resolve(restaurantId: string): Promise<ResolvedPaymentGateway | null>;
}
