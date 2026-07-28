import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import type { PaymentGatewayProvider } from '@prisma/client';
import { PAYMENT_GATEWAY_ADAPTER_METADATA } from '../domain/payment-gateway-adapter.decorator';
import type { PaymentGatewayPort } from '../application/ports/payment-gateway.port';

@Injectable()
export class PaymentGatewayRegistry implements OnModuleInit {
  private readonly logger = new Logger(PaymentGatewayRegistry.name);
  private readonly adapters = new Map<
    PaymentGatewayProvider,
    PaymentGatewayPort
  >();

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const wrappers = this.discoveryService.getProviders();

    for (const wrapper of wrappers) {
      const instance: unknown = wrapper.instance;

      if (!instance || typeof instance !== 'object') {
        continue;
      }

      const provider = this.reflector.get<PaymentGatewayProvider | undefined>(
        PAYMENT_GATEWAY_ADAPTER_METADATA,
        instance.constructor,
      );

      if (!provider) {
        continue;
      }

      this.adapters.set(provider, instance as PaymentGatewayPort);
      this.logger.log(`Pasarela de pago registrada: ${provider}`);
    }
  }

  get(provider: PaymentGatewayProvider): PaymentGatewayPort | undefined {
    return this.adapters.get(provider);
  }

  getAll(): PaymentGatewayPort[] {
    return Array.from(this.adapters.values());
  }
}
