import { SetMetadata } from '@nestjs/common';
import type { PaymentGatewayProvider } from '@prisma/client';

export const PAYMENT_GATEWAY_ADAPTER_METADATA = Symbol(
  'PAYMENT_GATEWAY_ADAPTER_METADATA',
);

export const PaymentGatewayAdapter = (
  provider: PaymentGatewayProvider,
): ClassDecorator => SetMetadata(PAYMENT_GATEWAY_ADAPTER_METADATA, provider);
