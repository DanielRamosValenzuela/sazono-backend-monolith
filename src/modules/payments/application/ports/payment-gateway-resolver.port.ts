import type { PaymentGatewayProvider } from '@prisma/client';
import type {
  GatewayCredentials,
  PaymentGatewayPort,
} from './payment-gateway.port';

export const PAYMENT_GATEWAY_RESOLVER = Symbol('PAYMENT_GATEWAY_RESOLVER');

export type ResolvedPaymentGateway = {
  provider: PaymentGatewayProvider;
  gateway: PaymentGatewayPort;
  accountId: string;
  publicKey: string | null;
  environment: string;
  checkoutMode: 'embedded' | 'redirect';
  displayPriority: number;
  credentials: GatewayCredentials;
};

export interface PaymentGatewayResolverPort {
  resolveAvailable(restaurantId: string): Promise<ResolvedPaymentGateway[]>;
}
