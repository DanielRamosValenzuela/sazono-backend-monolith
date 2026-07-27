import { Prisma } from '@prisma/client';
import type { GatewayChargeContext } from '../../application/ports/payment-gateway.port';

const createMock = jest.fn();
const getMock = jest.fn();
const cancelMock = jest.fn();
const mercadoPagoConfigMock = jest.fn();
const paymentClientMock = jest.fn();

jest.mock('mercadopago', () => ({
  MercadoPagoConfig: mercadoPagoConfigMock,
  Payment: paymentClientMock,
}));

import { MercadoPagoGatewayAdapter } from './mercado-pago-gateway.adapter';

describe('MercadoPagoGatewayAdapter', () => {
  const baseContext: GatewayChargeContext = {
    restaurantId: 'restaurant-1',
    attemptId: 'attempt-1',
    amount: new Prisma.Decimal(11800),
    currency: 'CLP',
    description: 'Pago de prueba',
    externalReference: 'attempt-1',
    cardToken: 'card-token-1',
    paymentMethodId: 'visa',
    installments: 1,
  };

  let adapter: MercadoPagoGatewayAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    mercadoPagoConfigMock.mockImplementation((config: unknown) => config);
    paymentClientMock.mockImplementation(() => ({
      create: createMock,
      get: getMock,
      cancel: cancelMock,
    }));
    adapter = new MercadoPagoGatewayAdapter('APP_USR-restaurant-token');
  });

  it('builds the MercadoPago client with the restaurant-specific access token', () => {
    expect(mercadoPagoConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'APP_USR-restaurant-token',
      }),
    );
  });

  it('approves a payment and returns the providerReference', async () => {
    createMock.mockResolvedValue({ id: 123, status: 'approved' });

    const result = await adapter.charge(baseContext);

    expect(result).toEqual({
      outcome: 'APPROVED',
      providerReference: '123',
      failureReason: undefined,
      rawStatus: 'approved',
      rawStatusDetail: undefined,
    });
  });

  it('rejects a payment with a readable failure reason', async () => {
    createMock.mockResolvedValue({
      id: 124,
      status: 'rejected',
      status_detail: 'cc_rejected_insufficient_amount',
    });

    const result = await adapter.charge(baseContext);

    expect(result).toEqual({
      outcome: 'REJECTED',
      providerReference: '124',
      failureReason: 'La tarjeta no tiene saldo suficiente.',
      rawStatus: 'rejected',
      rawStatusDetail: 'cc_rejected_insufficient_amount',
    });
  });

  it('treats a network failure as a rejection without a providerReference', async () => {
    createMock.mockRejectedValue(new Error('fetch failed'));

    const result = await adapter.charge(baseContext);

    expect(result.outcome).toBe('REJECTED');
    expect(result.providerReference).toBeUndefined();
    expect(result.failureReason).toBe(
      'No pudimos comunicarnos con la pasarela de pago. Intenta nuevamente.',
    );
  });

  it('cancels and rejects a pending payment even though binary_mode was requested', async () => {
    createMock.mockResolvedValue({ id: 125, status: 'in_process' });
    cancelMock.mockResolvedValue({ id: 125, status: 'cancelled' });

    const result = await adapter.charge(baseContext);

    expect(cancelMock).toHaveBeenCalledWith({ id: 125 });
    expect(result.outcome).toBe('REJECTED');
    expect(result.providerReference).toBe('125');
  });

  it('sends the amount as an integer for CLP and requests binary_mode with the attemptId as the idempotency key', async () => {
    createMock.mockResolvedValue({ id: 126, status: 'approved' });

    await adapter.charge(baseContext);

    expect(createMock).toHaveBeenCalledWith({
      body: expect.objectContaining({
        transaction_amount: 11800,
        binary_mode: true,
        token: 'card-token-1',
        payment_method_id: 'visa',
        installments: 1,
      }),
      requestOptions: {
        idempotencyKey: 'attempt-1',
      },
    });
  });

  it('never sends application_fee even when applicationFeeAmount is present on the context', async () => {
    createMock.mockResolvedValue({ id: 127, status: 'approved' });

    await adapter.charge({ ...baseContext, applicationFeeAmount: 500 });

    const sentBody = createMock.mock.calls[0][0].body as Record<
      string,
      unknown
    >;
    expect(sentBody.application_fee).toBeUndefined();
    expect('application_fee' in sentBody).toBe(false);
  });

  it('throws before calling the gateway when the CLP amount has decimals', async () => {
    await expect(
      adapter.charge({
        ...baseContext,
        amount: new Prisma.Decimal('11800.50'),
      }),
    ).rejects.toThrow('El monto a cobrar en CLP no admite decimales.');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('getPayment maps a stored payment back into a snapshot', async () => {
    getMock.mockResolvedValue({
      id: 128,
      status: 'approved',
      transaction_amount: 11800,
      currency_id: 'CLP',
    });

    const snapshot = await adapter.getPayment('128');

    expect(snapshot).toEqual({
      providerReference: '128',
      outcome: 'APPROVED',
      rawStatus: 'approved',
      rawStatusDetail: undefined,
      amount: '11800',
      currency: 'CLP',
    });
  });

  it('getPayment includes the externalReference so the webhook can correlate the original attempt', async () => {
    getMock.mockResolvedValue({
      id: 130,
      status: 'approved',
      transaction_amount: 11800,
      currency_id: 'CLP',
      external_reference: 'attempt-42',
    });

    const snapshot = await adapter.getPayment('130');

    expect(snapshot?.externalReference).toBe('attempt-42');
  });

  it('getPayment returns null when the gateway call fails', async () => {
    getMock.mockRejectedValue(new Error('not found'));

    const snapshot = await adapter.getPayment('129');

    expect(snapshot).toBeNull();
  });
});
