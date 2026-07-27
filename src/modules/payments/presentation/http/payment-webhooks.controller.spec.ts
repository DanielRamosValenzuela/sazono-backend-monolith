import { UnauthorizedException } from '@nestjs/common';
import { PaymentWebhooksController } from './payment-webhooks.controller';
import type { HandleMercadoPagoWebhookService } from '../../application/handle-mercado-pago-webhook.service';
import type { MercadoPagoSignatureVerifier } from '../../infrastructure/mercado-pago/mercado-pago-signature.verifier';

describe('PaymentWebhooksController', () => {
  const verifyMock = jest.fn();
  const signatureVerifier = {
    verify: verifyMock,
  } as unknown as MercadoPagoSignatureVerifier;

  const executeMock = jest.fn();
  const handleMercadoPagoWebhookService = {
    execute: executeMock,
  } as unknown as HandleMercadoPagoWebhookService;

  let controller: PaymentWebhooksController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PaymentWebhooksController(
      signatureVerifier,
      handleMercadoPagoWebhookService,
    );
  });

  const body = {
    id: 12345,
    type: 'payment',
    action: 'payment.updated',
    data: { id: '999999999' },
  };

  it('rejects with 401 and never invokes the handler when the signature is invalid', async () => {
    verifyMock.mockReturnValue({
      valid: false,
      reason: 'SIGNATURE_MISMATCH',
    });

    await expect(
      controller.handleMercadoPago(
        '999999999',
        'ts=1,v1=deadbeef',
        'request-1',
        body,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(executeMock).not.toHaveBeenCalled();
  });

  it('processes and acknowledges the notification when the signature is valid', async () => {
    verifyMock.mockReturnValue({ valid: true });
    executeMock.mockResolvedValue({ status: 'PROCESSED' });

    const result = await controller.handleMercadoPago(
      '999999999',
      'ts=1,v1=deadbeef',
      'request-1',
      body,
    );

    expect(result).toEqual({ received: true });
    expect(verifyMock).toHaveBeenCalledWith({
      xSignature: 'ts=1,v1=deadbeef',
      xRequestId: 'request-1',
      dataId: '999999999',
    });
    expect(executeMock).toHaveBeenCalledWith({
      body,
      dataId: '999999999',
    });
  });

  it('still acknowledges with 200 when the handler could not fully process the notification', async () => {
    verifyMock.mockReturnValue({ valid: true });
    executeMock.mockResolvedValue({ status: 'DEFERRED' });

    const result = await controller.handleMercadoPago(
      '999999999',
      'ts=1,v1=deadbeef',
      'request-1',
      body,
    );

    expect(result).toEqual({ received: true });
  });
});
