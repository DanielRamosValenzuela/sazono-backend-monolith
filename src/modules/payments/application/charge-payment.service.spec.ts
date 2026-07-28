import { Prisma, PaymentGatewayProvider } from '@prisma/client';
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

  const resolveAvailableMock = jest.fn();
  const paymentGatewayResolver: PaymentGatewayResolverPort = {
    resolveAvailable: resolveAvailableMock,
  };

  const chargeMock = jest.fn();
  const resolvedGateway: ResolvedPaymentGateway = {
    provider: PaymentGatewayProvider.MERCADO_PAGO,
    gateway: {
      providerName: 'MERCADO_PAGO',
      checkoutMode: 'embedded',
      charge: chargeMock,
      getPayment: jest.fn(),
    },
    accountId: 'account-1',
    publicKey: 'public-key-1',
    environment: 'sandbox',
    checkoutMode: 'embedded',
    displayPriority: 0,
    credentials: { accessToken: 'APP_USR-restaurant-token' },
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
      kind: 'SETTLED',
      approved: true,
      providerName: 'MANUAL',
      providerReference: 'manual-ref-1',
    });
    expect(resolveAvailableMock).not.toHaveBeenCalled();
    expect(chargeMock).not.toHaveBeenCalled();
    expect(recordMock).toHaveBeenCalledWith({
      amount: baseRequest.amount,
      currency: baseRequest.currency,
      description: baseRequest.description,
    });
  });

  it('resolves the gateway for QR_ONLINE and falls back to the offline recorder when no gateway is connected', async () => {
    resolveAvailableMock.mockResolvedValue([]);
    recordMock.mockResolvedValue({ providerReference: 'manual-ref-2' });

    const result = await service.execute({
      ...baseRequest,
      channel: PaymentChannel.QR_ONLINE,
    });

    expect(result).toEqual({
      kind: 'SETTLED',
      approved: true,
      providerName: 'MANUAL',
      providerReference: 'manual-ref-2',
    });
    expect(resolveAvailableMock).toHaveBeenCalledWith('restaurant-1');
    expect(chargeMock).not.toHaveBeenCalled();
    expect(recordMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the offline recorder for QR_ONLINE when the gateway is connected but no checkout was submitted', async () => {
    resolveAvailableMock.mockResolvedValue([resolvedGateway]);
    recordMock.mockResolvedValue({ providerReference: 'manual-ref-3' });

    const result = await service.execute({
      ...baseRequest,
      channel: PaymentChannel.QR_ONLINE,
    });

    expect(result).toEqual({
      kind: 'SETTLED',
      approved: true,
      providerName: 'MANUAL',
      providerReference: 'manual-ref-3',
    });
    expect(chargeMock).not.toHaveBeenCalled();
  });

  it('charges through the highest-priority resolved gateway for QR_ONLINE when a checkout is submitted', async () => {
    resolveAvailableMock.mockResolvedValue([resolvedGateway]);
    chargeMock.mockResolvedValue({
      kind: 'SETTLED',
      result: 'APPROVED',
      providerReference: 'mp-1',
    });

    const result = await service.execute({
      ...baseRequest,
      channel: PaymentChannel.QR_ONLINE,
      checkout,
    });

    expect(result).toEqual({
      kind: 'SETTLED',
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
      credentials: { accessToken: 'APP_USR-restaurant-token' },
      notificationUrl: undefined,
      checkoutPayload: checkout,
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
    resolveAvailableMock.mockResolvedValue([resolvedGateway]);
    chargeMock.mockResolvedValue({
      kind: 'SETTLED',
      result: 'APPROVED',
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
    resolveAvailableMock.mockResolvedValue([resolvedGateway]);
    chargeMock.mockResolvedValue({
      kind: 'SETTLED',
      result: 'APPROVED',
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
    resolveAvailableMock.mockResolvedValue([resolvedGateway]);
    chargeMock.mockResolvedValue({
      kind: 'SETTLED',
      result: 'REJECTED',
      providerReference: 'mp-2',
      failureReason: 'La tarjeta no tiene saldo suficiente.',
    });

    const result = await service.execute({
      ...baseRequest,
      channel: PaymentChannel.QR_ONLINE,
      checkout,
    });

    expect(result).toEqual({
      kind: 'SETTLED',
      approved: false,
      providerName: 'MERCADO_PAGO',
      providerReference: 'mp-2',
      failureReason: 'La tarjeta no tiene saldo suficiente.',
    });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('propagates a REDIRECT outcome from the gateway without treating it as approved or rejected', async () => {
    resolveAvailableMock.mockResolvedValue([resolvedGateway]);
    const expiresAt = new Date('2026-07-27T12:00:00.000Z');
    chargeMock.mockResolvedValue({
      kind: 'REDIRECT',
      providerReference: 'tbk-1',
      redirectUrl: 'https://webpay.example/init',
      method: 'POST',
      fields: { token_ws: 'abc' },
      expiresAt,
    });

    const result = await service.execute({
      ...baseRequest,
      channel: PaymentChannel.QR_ONLINE,
      checkout,
    });

    expect(result).toEqual({
      kind: 'REDIRECT',
      providerName: 'MERCADO_PAGO',
      providerReference: 'tbk-1',
      redirectUrl: 'https://webpay.example/init',
      method: 'POST',
      fields: { token_ws: 'abc' },
      expiresAt,
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
    resolveAvailableMock.mockResolvedValue([]);

    const result = await service.execute({
      ...baseRequest,
      channel: PaymentChannel.QR_ONLINE,
    });

    expect(result.kind).toBe('SETTLED');
    expect(result).toMatchObject({ approved: false });
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
    resolveAvailableMock.mockResolvedValue([resolvedGateway]);

    const result = await service.execute({
      ...baseRequest,
      channel: PaymentChannel.QR_ONLINE,
    });

    expect(result.kind).toBe('SETTLED');
    expect(result).toMatchObject({
      approved: false,
      providerName: 'MERCADO_PAGO',
    });
    expect(recordMock).not.toHaveBeenCalled();
    expect(chargeMock).not.toHaveBeenCalled();
  });
});
