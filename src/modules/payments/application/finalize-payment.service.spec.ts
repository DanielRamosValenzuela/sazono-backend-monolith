import { PaymentMethod, Prisma } from '@prisma/client';
import { FinalizePaymentService } from './finalize-payment.service';

function buildTx(options: { sessionId?: string; require?: boolean }) {
  return {
    paymentAttempt: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    payment: { create: jest.fn().mockResolvedValue({ id: 'p1' }) },
    bill: {
      findUnique: jest.fn().mockResolvedValue({
        branchId: 'b1',
        branch: {
          settings: { requireOpenCashSession: !!options.require },
        },
      }),
    },
    $queryRaw: jest
      .fn()
      .mockResolvedValue(options.sessionId ? [{ id: options.sessionId }] : []),
  };
}

const input = {
  attemptId: 'a1',
  billId: 'bill1',
  amount: new Prisma.Decimal(1000),
  currency: 'CLP',
  provider: 'MANUAL',
  method: PaymentMethod.CASH,
  staffUserId: 's1',
};

describe('FinalizePaymentService cash session link', () => {
  const service = new FinalizePaymentService();

  it('links the payment to the open session of the collector', async () => {
    const tx = buildTx({ sessionId: 'cs1' });

    await service.execute(tx as never, input);

    expect(tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cashSessionId: 'cs1' }),
      }),
    );
  });

  it('leaves it empty when there is no session and none is required', async () => {
    const tx = buildTx({});

    await service.execute(tx as never, input);

    expect(tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cashSessionId: null }),
      }),
    );
  });

  it('blocks manual cash without session when the branch requires one', async () => {
    const tx = buildTx({ require: true });

    await expect(service.execute(tx as never, input)).rejects.toMatchObject({
      response: { code: 'CASH_SESSION_REQUIRED' },
    });
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('does not require a session for card payments or web payments', async () => {
    const card = buildTx({ require: true });
    await service.execute(card as never, {
      ...input,
      method: PaymentMethod.CREDIT_CARD,
    });
    expect(card.payment.create).toHaveBeenCalled();

    const web = buildTx({ require: true });
    await service.execute(web as never, { ...input, staffUserId: undefined });
    expect(web.bill.findUnique).not.toHaveBeenCalled();
  });
});
