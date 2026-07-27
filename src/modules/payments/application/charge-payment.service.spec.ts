import { Prisma } from '@prisma/client';
import { ChargePaymentService } from './charge-payment.service';
import { PaymentChannel } from '../domain/payment-channel';
import type { MercadoPagoConfigService } from '../infrastructure/mercado-pago/mercado-pago-config.service';
import type { OfflinePaymentRecorderPort } from './ports/offline-payment-recorder.port';
import type {
  PaymentGatewayResolverPort,
  ResolvedPaymentGateway,
} from './ports/payment-gateway-resolver.port';

describe('ChargePaymentService', () => {
  const recordMock = jest.fn();
  const offlinePaymentRecorder: OfflinePaymentRecorderPort = {
    providerName: 'MANUAL',
    record: recordMock,
  };

  const resolveMock = jest.fn();
  const paymentGatewayResolver: PaymentGatewayResolverPort = {
    resolve: resolveMock,
  };

  const chargeMock = jest.fn();
  const resolvedGateway: ResolvedPaymentGateway = {
    gateway: {
      providerName: 'MERCADO_PAGO',
      charge: chargeMock,
      getPayment: jest.fn(),
    },
    accountId: 'account-1',
    publicKey: 'public-key-1',
    environment: 'sandbox',
  };

  let mercadoPagoConfig: MercadoPagoConfigService;
  let service: ChargePaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    mercadoPagoConfig = {
      qrGatewayRequired: false,
    } as unknown as MercadoPagoConfigService;
    service = new ChargePaymentService(
      offlinePaymentRecorder,
      paymentGatewayResolver,
      mercadoPagoConfig,
    );
  });

  const baseRequest = {
    restaurantId: 'restaurant-1',
    attemptId: 'attempt-1',
    amount: new Prisma.Decimal(11800),
    currency: 'CLP',
    description: 'Pago de prueba',
  };

  const checkout = {
    cardToken: 'card-token-1',
    paymentMethodId: 'visa',
    installments: 1,
  };

  it('records the payment offline for STAFF_OFFLINE and never consults the gateway resolver', async () => {
    recordMock.mockResolvedValue({ providerReference: 'manual-ref-1' });

    const result = await service.execute({
      ...baseRequest,
      channel: PaymentChannel.STAFF_OFFLINE,
      checkout,
    });

    expect(result).toEqual({
      approved: true,
      providerName: 'MANUAL',
      providerReference: 'manual-ref-1',
    });
    expect(resolveMock).not.toHaveBeenCalled();
    expect(chargeMock).not.toHaveBeenCalled();
    expect(recordMock).toHaveBeenCalledWith({
      amount: baseRequest.amount,
      currency: baseRequest.currency,
      description: baseRequest.description,
    });
  });

  it('resolves the gateway for QR_ONLINE and falls back to the offline recorder when no gateway is connected', async () => {
    resolveMock.mockResolvedValue(null);
    recordMock.mockResolvedValue({ providerReference: 'manual-ref-2' });

    const result = await service.execute({
      ...baseRequest,
      channel: PaymentChannel.QR_ONLINE,
    });

    expect(result).toEqual({
      approved: true,
      providerName: 'MANUAL',
      providerReference: 'manual-ref-2',
    });
    expect(resolveMock).toHaveBeenCalledWith('restaurant-1');
    expect(chargeMock).not.toHaveBeenCalled();
    expect(recordMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the offline recorder for QR_ONLINE when the gateway is connected but no checkout was submitted', async () => {
    resolveMock.mockResolvedValue(resolvedGateway);
    recordMock.mockResolvedValue({ providerReference: 'manual-ref-3' });

    const result = await service.execute({
      ...baseRequest,
      channel: PaymentChannel.QR_ONLINE,
    });

    expect(result).toEqual({
      approved: true,
      providerName: 'MANUAL',
      providerReference: 'manual-ref-3',
    });
    expect(chargeMock).not.toHaveBeenCalled();
  });

  it('charges through the resolved gateway for QR_ONLINE when a checkout is submitted', async () => {
    resolveMock.mockResolvedValue(resolvedGateway);
    chargeMock.mockResolvedValue({
      outcome: 'APPROVED',
      providerReference: 'mp-1',
    });

    const result = await service.execute({
      ...baseRequest,
      channel: PaymentChannel.QR_ONLINE,
      checkout,
    });

    expect(result).toEqual({
      approved: true,
      providerName: 'MERCADO_PAGO',
      providerReference: 'mp-1',
      failureReason: undefined,
    });
    expect(recordMock).not.toHaveBeenCalled();
    expect(chargeMock).toHaveBeenCalledWith({
      restaurantId: 'restaurant-1',
      attemptId: 'attempt-1',
      amount: baseRequest.amount,
      currency: 'CLP',
      description: 'Pago de prueba',
      externalReference: 'attempt-1',
      cardToken: 'card-token-1',
      paymentMethodId: 'visa',
      installments: 1,
      issuerId: undefined,
      payerEmail: undefined,
      notificationUrl: undefined,
    });
  });

  it('forwards the configured MercadoPago webhook URL as notificationUrl when available', async () => {
    mercadoPagoConfig = {
      qrGatewayRequired: false,
      webhookUrl: 'https://api.sazono.cl/api/v1/webhooks/payments/mercado-pago',
    } as unknown as MercadoPagoConfigService;
    service = new ChargePaymentService(
      offlinePaymentRecorder,
      paymentGatewayResolver,
      mercadoPagoConfig,
    );
    resolveMock.mockResolvedValue(resolvedGateway);
    chargeMock.mockResolvedValue({
      outcome: 'APPROVED',
      providerReference: 'mp-1',
    });

    await service.execute({
      ...baseRequest,
      channel: PaymentChannel.QR_ONLINE,
      checkout,
    });

    expect(chargeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationUrl:
          'https://api.sazono.cl/api/v1/webhooks/payments/mercado-pago',
      }),
    );
  });

  it('never throws when reading the webhook URL fails because Mercado Pago is not configured', async () => {
    mercadoPagoConfig = {
      qrGatewayRequired: false,
      get webhookUrl(): string {
        throw new Error('Mercado Pago no esta configurado.');
      },
    } as unknown as MercadoPagoConfigService;
    service = new ChargePaymentService(
      offlinePaymentRecorder,
      paymentGatewayResolver,
      mercadoPagoConfig,
    );
    resolveMock.mockResolvedValue(resolvedGateway);
    chargeMock.mockResolvedValue({
      outcome: 'APPROVED',
      providerReference: 'mp-1',
    });

    await service.execute({
      ...baseRequest,
      channel: PaymentChannel.QR_ONLINE,
      checkout,
    });

    expect(chargeMock).toHaveBeenCalledWith(
      expect.objectContaining({ notificationUrl: undefined }),
    );
  });

  it('reports the rejection returned by the gateway without touching the offline recorder', async () => {
    resolveMock.mockResolvedValue(resolvedGateway);
    chargeMock.mockResolvedValue({
      outcome: 'REJECTED',
      providerReference: 'mp-2',
      failureReason: 'La tarjeta no tiene saldo suficiente.',
    });

    const result = await service.execute({
      ...baseRequest,
      channel: PaymentChannel.QR_ONLINE,
      checkout,
    });

    expect(result).toEqual({
      approved: false,
      providerName: 'MERCADO_PAGO',
      providerReference: 'mp-2',
      failureReason: 'La tarjeta no tiene saldo suficiente.',
    });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('rejects instead of falling back offline when PAYMENTS_QR_GATEWAY_REQUIRED is true and no gateway is connected', async () => {
    mercadoPagoConfig = {
      qrGatewayRequired: true,
    } as unknown as MercadoPagoConfigService;
    service = new ChargePaymentService(
      offlinePaymentRecorder,
      paymentGatewayResolver,
      mercadoPagoConfig,
    );
    resolveMock.mockResolvedValue(null);

    const result = await service.execute({
      ...baseRequest,
      channel: PaymentChannel.QR_ONLINE,
    });

    expect(result.approved).toBe(false);
    expect(recordMock).not.toHaveBeenCalled();
    expect(chargeMock).not.toHaveBeenCalled();
  });

  it('rejects instead of falling back offline when PAYMENTS_QR_GATEWAY_REQUIRED is true and the checkout is missing', async () => {
    mercadoPagoConfig = {
      qrGatewayRequired: true,
    } as unknown as MercadoPagoConfigService;
    service = new ChargePaymentService(
      offlinePaymentRecorder,
      paymentGatewayResolver,
      mercadoPagoConfig,
    );
    resolveMock.mockResolvedValue(resolvedGateway);

    const result = await service.execute({
      ...baseRequest,
      channel: PaymentChannel.QR_ONLINE,
    });

    expect(result.approved).toBe(false);
    expect(result.providerName).toBe('MERCADO_PAGO');
    expect(recordMock).not.toHaveBeenCalled();
    expect(chargeMock).not.toHaveBeenCalled();
  });
});
