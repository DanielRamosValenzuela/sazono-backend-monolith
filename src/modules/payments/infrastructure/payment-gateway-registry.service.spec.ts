import { Injectable } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { PaymentGatewayProvider } from '@prisma/client';
import { PaymentGatewayAdapter } from '../domain/payment-gateway-adapter.decorator';
import { PaymentGatewayRegistry } from './payment-gateway-registry.service';
import type {
  GatewayChargeOutcome,
  GatewayPaymentSnapshot,
  PaymentGatewayPort,
} from '../application/ports/payment-gateway.port';

@Injectable()
@PaymentGatewayAdapter(PaymentGatewayProvider.MERCADO_PAGO)
class FakeMercadoPagoAdapter implements PaymentGatewayPort {
  readonly providerName = 'MERCADO_PAGO';
  readonly checkoutMode = 'embedded' as const;

  charge(): Promise<GatewayChargeOutcome> {
    return Promise.resolve({ kind: 'SETTLED', result: 'APPROVED' });
  }

  getPayment(): Promise<GatewayPaymentSnapshot | null> {
    return Promise.resolve(null);
  }
}

@Injectable()
class UndecoratedProvider {}

describe('PaymentGatewayRegistry', () => {
  it('discovers a @PaymentGatewayAdapter-decorated provider only once Nest has finished bootstrapping the module', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [DiscoveryModule],
      providers: [
        PaymentGatewayRegistry,
        FakeMercadoPagoAdapter,
        UndecoratedProvider,
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const registry = app.get(PaymentGatewayRegistry);
    const adapterInstance = app.get(FakeMercadoPagoAdapter);

    const registered = registry.get(PaymentGatewayProvider.MERCADO_PAGO);

    expect(registered).toBe(adapterInstance);
    expect(registry.getAll()).toEqual([adapterInstance]);

    await app.close();
  });

  it('returns undefined for a provider that never registered a decorated adapter', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [DiscoveryModule],
      providers: [PaymentGatewayRegistry],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const registry = app.get(PaymentGatewayRegistry);

    expect(registry.get(PaymentGatewayProvider.MERCADO_PAGO)).toBeUndefined();
    expect(registry.getAll()).toEqual([]);

    await app.close();
  });
});
