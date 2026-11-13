import { Prisma } from '@prisma/client';
import type { GatewayChargeContext } from '../../application/ports/payment-gateway.port';
import type { MercadoPagoConfigService } from './mercado-pago-config.service';

const createMock = jest.fn();
const getMock = jest.fn();
const cancelMock = jest.fn();
const orderCreateMock = jest.fn();
const orderGetMock = jest.fn();
const orderCancelMock = jest.fn();
const orderSearchMock = jest.fn();
const mercadoPagoConfigMock = jest.fn();
const paymentClientMock = jest.fn();
const orderClientMock = jest.fn();

jest.mock('mercadopago', () => ({
  MercadoPagoConfig: mercadoPagoConfigMock,
  Payment: paymentClientMock,
  Order: orderClientMock,
}));

import { MercadoPagoGatewayAdapter } from './mercado-pago-gateway.adapter';

describe('MercadoPagoGatewayAdapter', () => {
  const credentials = { accessToken: 'APP_USR-restaurant-token' };

  const baseContext: GatewayChargeContext = {
    restaurantId: 'restaurant-1',
    attemptId: 'attempt-1',
    amount: new Prisma.Decimal(11800),
    currency: 'CLP',
    description: 'Pago de prueba',
    externalReference: 'attempt-1',
    credentials,
    checkoutPayload: {
      cardToken: 'card-token-1',
      paymentMethodId: 'visa',
      installments: 1,
    },
  };

  let adapter: MercadoPagoGatewayAdapter;
  let mercadoPagoConfig: MercadoPagoConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    mercadoPagoConfigMock.mockImplementation((config: unknown) => config);
    paymentClientMock.mockImplementation(() => ({
      create: createMock,
      get: getMock,
      cancel: cancelMock,
    }));
    orderClientMock.mockImplementation(() => ({
      create: orderCreateMock,
      get: orderGetMock,
      cancel: orderCancelMock,
      search: orderSearchMock,
    }));
    mercadoPagoConfig = {
      timeoutMs: 15000,
    } as unknown as MercadoPagoConfigService;
    adapter = new MercadoPagoGatewayAdapter(mercadoPagoConfig);
  });

  it('is a stateless singleton: it never receives credentials in its constructor', () => {
    expect(adapter).toBeInstanceOf(MercadoPagoGatewayAdapter);
    expect(mercadoPagoConfigMock).not.toHaveBeenCalled();
  });

  it('builds the MercadoPago client per call with the restaurant-specific access token from the context', async () => {
    createMock.mockResolvedValue({ id: 123, status: 'approved' });

    await adapter.charge(baseContext);

    expect(mercadoPagoConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'APP_USR-restaurant-token',
      }),
    );
  });

  it('approves a payment and returns a SETTLED outcome with the providerReference', async () => {
    createMock.mockResolvedValue({ id: 123, status: 'approved' });

    const result = await adapter.charge(baseContext);

    expect(result).toEqual({
      kind: 'SETTLED',
      result: 'APPROVED',
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
      kind: 'SETTLED',
      result: 'REJECTED',
      providerReference: '124',
      failureReason: 'La tarjeta no tiene saldo suficiente.',
      rawStatus: 'rejected',
      rawStatusDetail: 'cc_rejected_insufficient_amount',
    });
  });

  it('treats a network failure as a rejection without a providerReference', async () => {
    createMock.mockRejectedValue(new Error('fetch failed'));

    const result = await adapter.charge(baseContext);

    expect(result.kind).toBe('SETTLED');
    expect(result).toMatchObject({ result: 'REJECTED' });
    expect(
      result.kind === 'SETTLED' ? result.providerReference : undefined,
    ).toBeUndefined();
    expect(result).toMatchObject({
      failureReason:
        'No pudimos comunicarnos con la pasarela de pago. Intenta nuevamente.',
    });
  });

  it('cancels and rejects a pending payment even though binary_mode was requested', async () => {
    createMock.mockResolvedValue({ id: 125, status: 'in_process' });
    cancelMock.mockResolvedValue({ id: 125, status: 'cancelled' });

    const result = await adapter.charge(baseContext);

    expect(cancelMock).toHaveBeenCalledWith({ id: 125 });
    expect(result.kind).toBe('SETTLED');
    expect(result).toMatchObject({
      result: 'REJECTED',
      providerReference: '125',
    });
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

  it('rejects with a SETTLED outcome when the checkout payload is missing or malformed', async () => {
    const result = await adapter.charge({
      ...baseContext,
      checkoutPayload: undefined,
    });

    expect(result).toEqual({
      kind: 'SETTLED',
      result: 'REJECTED',
      failureReason:
        'Falta el token de la tarjeta para completar el pago con Mercado Pago.',
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('getPayment builds the client with the credentials passed as an argument and maps a stored payment back into a snapshot', async () => {
    getMock.mockResolvedValue({
      id: 128,
      status: 'approved',
      transaction_amount: 11800,
      currency_id: 'CLP',
    });

    const snapshot = await adapter.getPayment('128', credentials);

    expect(mercadoPagoConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'APP_USR-restaurant-token' }),
    );
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

    const snapshot = await adapter.getPayment('130', credentials);

    expect(snapshot?.externalReference).toBe('attempt-42');
  });

  it('getPayment returns null when the gateway call fails', async () => {
    getMock.mockRejectedValue(new Error('not found'));

    const snapshot = await adapter.getPayment('129', credentials);

    expect(snapshot).toBeNull();
  });

  describe('orders mode', () => {
    beforeEach(() => {
      Object.assign(mercadoPagoConfig, { apiMode: 'orders' });
    });

    it('creates the order with string amounts, card payment method, marketplace_fee and the attemptId as idempotency key', async () => {
      orderCreateMock.mockResolvedValue({ id: 'ORD1', status: 'processed' });

      const result = await adapter.charge({
        ...baseContext,
        applicationFeeAmount: 118,
        checkoutPayload: {
          ...(baseContext.checkoutPayload as object),
          paymentTypeId: 'debit_card',
          payerEmail: 'a@b.cl',
        },
      });

      expect(createMock).not.toHaveBeenCalled();
      expect(orderCreateMock).toHaveBeenCalledWith({
        body: {
          type: 'online',
          external_reference: 'attempt-1',
          total_amount: '11800',
          currency: 'CLP',
          capture_mode: 'automatic',
          description: 'Pago de prueba',
          payer: { email: 'a@b.cl' },
          marketplace_fee: '118',
          transactions: {
            payments: [
              {
                amount: '11800',
                payment_method: {
                  id: 'visa',
                  type: 'debit_card',
                  token: 'card-token-1',
                  installments: 1,
                },
              },
            ],
          },
        },
        requestOptions: { idempotencyKey: 'attempt-1' },
      });
      expect(result).toMatchObject({
        kind: 'SETTLED',
        result: 'APPROVED',
        providerReference: 'ORD1',
      });
    });

    it('defaults the payment type to credit_card and omits marketplace_fee when there is no fee', async () => {
      orderCreateMock.mockResolvedValue({ id: 'ORD2', status: 'processed' });

      await adapter.charge(baseContext);

      const body = orderCreateMock.mock.calls[0][0].body;
      expect(body.transactions.payments[0].payment_method.type).toBe(
        'credit_card',
      );
      expect(body.marketplace_fee).toBeUndefined();
    });

    it('rejects a failed order using the payment status_detail', async () => {
      orderCreateMock.mockResolvedValue({
        id: 'ORD3',
        status: 'failed',
        transactions: {
          payments: [{ status_detail: 'cc_rejected_insufficient_amount' }],
        },
      });

      const result = await adapter.charge(baseContext);

      expect(result).toMatchObject({
        result: 'REJECTED',
        providerReference: 'ORD3',
        failureReason: 'La tarjeta no tiene saldo suficiente.',
      });
    });

    it.each(['created', 'processing', 'action_required', 'something_new'])(
      'returns a PENDING outcome with the order id for a non-final %s order and never cancels it',
      async (status) => {
        orderCreateMock.mockResolvedValue({ id: 'ORD4', status });

        const result = await adapter.charge(baseContext);

        expect(orderCancelMock).not.toHaveBeenCalled();
        expect(result).toMatchObject({
          kind: 'PENDING',
          providerReference: 'ORD4',
          rawStatus: status,
        });
      },
    );

    it('rejects a non-final order that carries no id because it cannot be reconciled', async () => {
      orderCreateMock.mockResolvedValue({ status: 'processing' });

      const result = await adapter.charge(baseContext);

      expect(result).toMatchObject({ kind: 'SETTLED', result: 'REJECTED' });
    });

    it('fetches the existing order on an idempotency conflict instead of rejecting', async () => {
      orderCreateMock.mockRejectedValue({ status: 409 });
      orderSearchMock.mockResolvedValue({
        data: [{ id: 'ORD6', status: 'processed' }],
      });

      const result = await adapter.charge(baseContext);

      expect(orderSearchMock).toHaveBeenCalledWith({
        options: expect.objectContaining({ external_reference: 'attempt-1' }),
      });
      expect(result).toMatchObject({
        result: 'APPROVED',
        providerReference: 'ORD6',
      });
    });

    it('leaves the charge PENDING without reference when the idempotency conflict finds no existing order', async () => {
      orderCreateMock.mockRejectedValue({ status: 423 });
      orderSearchMock.mockResolvedValue({ data: [] });

      const result = await adapter.charge(baseContext);

      expect(result).toEqual({ kind: 'PENDING' });
    });

    it('leaves the charge PENDING instead of rejecting when order creation fails ambiguously', async () => {
      orderCreateMock.mockRejectedValue(new Error('timeout'));
      orderSearchMock.mockResolvedValue({ data: [] });

      const result = await adapter.charge(baseContext);

      expect(result).toEqual({ kind: 'PENDING' });
    });

    it('recovers the order created by an ambiguous failure through its external reference', async () => {
      orderCreateMock.mockRejectedValue({ status: 502 });
      orderSearchMock.mockResolvedValue({
        data: [{ id: 'ORD9', status: 'processed' }],
      });

      const result = await adapter.charge(baseContext);

      expect(result).toMatchObject({
        kind: 'SETTLED',
        result: 'APPROVED',
        providerReference: 'ORD9',
      });
    });

    it('rejects when Mercado Pago answers with a definitive 4xx error', async () => {
      orderCreateMock.mockRejectedValue({ status: 400 });
      orderSearchMock.mockResolvedValue({ data: [] });

      const result = await adapter.charge(baseContext);

      expect(result).toMatchObject({ kind: 'SETTLED', result: 'REJECTED' });
    });

    it('findByExternalReference resolves the order through search and get', async () => {
      orderSearchMock.mockResolvedValue({ data: [{ id: 'ORD7' }] });
      orderGetMock.mockResolvedValue({ id: 'ORD7', status: 'processed' });

      const snapshot = await adapter.findByExternalReference(
        'attempt-7',
        credentials,
      );

      expect(snapshot).toMatchObject({
        providerReference: 'ORD7',
        outcome: 'APPROVED',
      });
    });

    it('findByExternalReference returns null when no order exists', async () => {
      orderSearchMock.mockResolvedValue({ data: [] });

      await expect(
        adapter.findByExternalReference('attempt-7', credentials),
      ).resolves.toBeNull();
    });

    it('getPayment maps an order into the snapshot shape', async () => {
      orderGetMock.mockResolvedValue({
        id: 'ORD7',
        status: 'processed',
        total_amount: '11800',
        currency: 'CLP',
        external_reference: 'attempt-7',
      });

      const snapshot = await adapter.getPayment('ORD7', credentials);

      expect(orderGetMock).toHaveBeenCalledWith({ id: 'ORD7' });
      expect(snapshot).toEqual({
        providerReference: 'ORD7',
        outcome: 'APPROVED',
        rawStatus: 'processed',
        rawStatusDetail: undefined,
        amount: '11800',
        currency: 'CLP',
        externalReference: 'attempt-7',
      });
    });

    it('getPayment returns null when the order call fails', async () => {
      orderGetMock.mockRejectedValue(new Error('not found'));

      expect(await adapter.getPayment('ORD8', credentials)).toBeNull();
    });
  });
});
