import { Prisma } from '@prisma/client';
import type { GatewayChargeContext } from '../../application/ports/payment-gateway.port';
import type { TransbankConfigService } from './transbank-config.service';

const createMock = jest.fn();
const commitMock = jest.fn();
const statusMock = jest.fn();
const mallTransactionMock = jest.fn();
const optionsMock = jest.fn();
const transactionDetailMock = jest.fn();

jest.mock('transbank-sdk', () => ({
  WebpayPlus: {
    MallTransaction: mallTransactionMock,
  },
  Options: optionsMock,
  TransactionDetail: transactionDetailMock,
}));

import { WebpayMallGatewayAdapter } from './webpay-mall-gateway.adapter';

describe('WebpayMallGatewayAdapter', () => {
  const credentials = { childCommerceCode: '597055555536' };

  const baseContext: GatewayChargeContext = {
    restaurantId: 'restaurant-1',
    attemptId: '11111111-1111-4111-8111-111111111111',
    amount: new Prisma.Decimal(11800),
    currency: 'CLP',
    description: 'Pago de prueba',
    externalReference: 'attempt-1',
    credentials,
  };

  let adapter: WebpayMallGatewayAdapter;
  let transbankConfig: TransbankConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    optionsMock.mockImplementation(
      (
        commerceCode: string,
        apiKey: string,
        environment: string,
        timeout: number,
      ) => ({
        commerceCode,
        apiKey,
        environment,
        timeout,
      }),
    );
    transactionDetailMock.mockImplementation(
      (amount: number, commerceCode: string, buyOrder: string) => ({
        amount,
        commerceCode,
        buyOrder,
      }),
    );
    mallTransactionMock.mockImplementation(() => ({
      create: createMock,
      commit: commitMock,
      status: statusMock,
    }));
    transbankConfig = {
      mallCommerceCode: '597055555535',
      apiKey:
        '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C',
      environmentUrl: 'https://webpay3gint.transbank.cl',
      returnUrl: 'https://sazono.example/return',
      timeoutMs: 15000,
    } as unknown as TransbankConfigService;
    adapter = new WebpayMallGatewayAdapter(transbankConfig);
  });

  it('is a stateless singleton: it never receives restaurant credentials in its constructor', () => {
    expect(adapter).toBeInstanceOf(WebpayMallGatewayAdapter);
    expect(mallTransactionMock).not.toHaveBeenCalled();
  });

  it('declares checkoutMode redirect', () => {
    expect(adapter.checkoutMode).toBe('redirect');
  });

  it('builds the Webpay client per call with the platform mall commerce code and api key from config', async () => {
    createMock.mockResolvedValue({
      token: 'token-123',
      url: 'https://webpay3gint.transbank.cl/pay',
    });

    await adapter.charge(baseContext);

    expect(optionsMock).toHaveBeenCalledWith(
      '597055555535',
      '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C',
      'https://webpay3gint.transbank.cl',
      15000,
    );
  });

  it('creates the transaction with a deterministic buyOrder derived from the attemptId and the restaurant childCommerceCode', async () => {
    createMock.mockResolvedValue({
      token: 'token-123',
      url: 'https://webpay3gint.transbank.cl/pay',
    });

    await adapter.charge(baseContext);

    expect(createMock).toHaveBeenCalledTimes(1);
    const [buyOrder, sessionId, returnUrl, details] = createMock.mock
      .calls[0] as [string, string, string, unknown[]];
    expect(buyOrder.length).toBeLessThanOrEqual(26);
    expect(sessionId).toBe(buyOrder);
    expect(returnUrl).toBe('https://sazono.example/return');
    expect(details).toHaveLength(1);
    expect(transactionDetailMock).toHaveBeenCalledWith(
      11800,
      '597055555536',
      buyOrder,
    );
  });

  it('returns a REDIRECT outcome with the token and url from Transbank', async () => {
    createMock.mockResolvedValue({
      token: 'token-abc',
      url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction',
    });

    const result = await adapter.charge(baseContext);

    expect(result.kind).toBe('REDIRECT');
    expect(result).toMatchObject({
      kind: 'REDIRECT',
      providerReference: 'token-abc',
      redirectUrl:
        'https://webpay3gint.transbank.cl/webpayserver/initTransaction',
      method: 'POST',
      fields: { token_ws: 'token-abc' },
    });
    expect(
      result.kind === 'REDIRECT' ? result.expiresAt : undefined,
    ).toBeInstanceOf(Date);
  });

  it('rejects with a SETTLED outcome when the restaurant has no childCommerceCode resolved', async () => {
    const result = await adapter.charge({
      ...baseContext,
      credentials: {},
    });

    expect(result).toEqual({
      kind: 'SETTLED',
      result: 'REJECTED',
      failureReason:
        'Este restaurante no tiene un codigo de comercio Transbank configurado.',
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('treats a network failure on create as a SETTLED rejection', async () => {
    createMock.mockRejectedValue(new Error('timeout'));

    const result = await adapter.charge(baseContext);

    expect(result).toEqual({
      kind: 'SETTLED',
      result: 'REJECTED',
      failureReason:
        'No pudimos comunicarnos con la pasarela de pago. Intenta nuevamente.',
    });
  });

  it('throws before calling Transbank when the CLP amount has decimals', async () => {
    await expect(
      adapter.charge({
        ...baseContext,
        amount: new Prisma.Decimal('11800.50'),
      }),
    ).rejects.toThrow('El monto a cobrar en CLP no admite decimales.');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('confirmRedirect commits the transaction and approves when status is AUTHORIZED with response_code 0', async () => {
    commitMock.mockResolvedValue({
      buy_order: 'sz-abc123',
      details: [
        {
          amount: 11800,
          status: 'AUTHORIZED',
          response_code: 0,
          authorization_code: '123456',
          commerce_code: '597055555536',
          buy_order: 'sz-abc123',
        },
      ],
    });

    const result = await adapter.confirmRedirect('token-abc', credentials);

    expect(commitMock).toHaveBeenCalledWith('token-abc');
    expect(result).toEqual({
      kind: 'SETTLED',
      result: 'APPROVED',
      providerReference: 'token-abc',
      failureReason: undefined,
      rawStatus: 'AUTHORIZED',
      rawStatusDetail: '0',
    });
  });

  it('confirmRedirect rejects when the transaction was FAILED', async () => {
    commitMock.mockResolvedValue({
      buy_order: 'sz-abc123',
      details: [
        {
          amount: 11800,
          status: 'FAILED',
          response_code: -1,
          commerce_code: '597055555536',
          buy_order: 'sz-abc123',
        },
      ],
    });

    const result = await adapter.confirmRedirect('token-abc', credentials);

    expect(result).toMatchObject({
      kind: 'SETTLED',
      result: 'REJECTED',
      providerReference: 'token-abc',
    });
  });

  it('confirmRedirect treats a network failure as a rejection that keeps the providerReference', async () => {
    commitMock.mockRejectedValue(new Error('timeout'));

    const result = await adapter.confirmRedirect('token-abc', credentials);

    expect(result).toEqual({
      kind: 'SETTLED',
      result: 'REJECTED',
      providerReference: 'token-abc',
      failureReason:
        'No pudimos comunicarnos con la pasarela de pago. Intenta nuevamente.',
    });
  });

  it('getPayment maps a stored transaction status back into a snapshot', async () => {
    statusMock.mockResolvedValue({
      buy_order: 'sz-abc123',
      details: [
        {
          amount: 11800,
          status: 'AUTHORIZED',
          response_code: 0,
          commerce_code: '597055555536',
          buy_order: 'sz-abc123',
        },
      ],
    });

    const snapshot = await adapter.getPayment('token-abc', credentials);

    expect(statusMock).toHaveBeenCalledWith('token-abc');
    expect(snapshot).toEqual({
      providerReference: 'token-abc',
      outcome: 'APPROVED',
      rawStatus: 'AUTHORIZED',
      rawStatusDetail: '0',
      amount: '11800',
      currency: 'CLP',
      externalReference: 'sz-abc123',
    });
  });

  it('getPayment returns null when the gateway call fails', async () => {
    statusMock.mockRejectedValue(new Error('not found'));

    const snapshot = await adapter.getPayment('token-abc', credentials);

    expect(snapshot).toBeNull();
  });

  it('getPayment returns null when the response has no details', async () => {
    statusMock.mockResolvedValue({ buy_order: 'sz-abc123', details: [] });

    const snapshot = await adapter.getPayment('token-abc', credentials);

    expect(snapshot).toBeNull();
  });
});
