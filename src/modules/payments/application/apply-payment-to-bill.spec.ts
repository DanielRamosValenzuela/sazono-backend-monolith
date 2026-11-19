import { Prisma } from '@prisma/client';
import { OrderStatus } from '@prisma/client';
import { enqueueBoletaForPaidBill } from '../../billing/application/enqueue-boleta';
import { applyPaymentToBill } from './apply-payment-to-bill';

jest.mock('../../billing/application/lock-bill', () => ({
  lockBill: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../billing/application/refresh-bill-discounts', () => ({
  refreshBillDiscounts: jest
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        new (jest.requireActual<{ Prisma: typeof Prisma }>(
          '@prisma/client',
        ).Prisma.Decimal)(0),
      ),
    ),
}));

function buildTx(remainingAmount: number) {
  const orderUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const orderItemUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const tx = {
    bill: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'bill-1',
        tableSessionId: 'session-1',
        subtotalAmount: new Prisma.Decimal(1000),
        tipAmount: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(1000),
        remainingAmount: new Prisma.Decimal(remainingAmount),
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    order: { updateMany: orderUpdateMany },
    orderItem: { updateMany: orderItemUpdateMany },
    tableSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };

  return { tx, orderUpdateMany, orderItemUpdateMany };
}

jest.mock('../../billing/application/enqueue-boleta');

describe('applyPaymentToBill', () => {
  it('marks READY orders as DELIVERED when the bill is fully paid', async () => {
    const { tx, orderUpdateMany, orderItemUpdateMany } = buildTx(1000);

    const result = await applyPaymentToBill(
      tx as never,
      'bill-1',
      new Prisma.Decimal(1000),
      new Prisma.Decimal(0),
    );

    expect(result.status).toBe('PAID');
    expect(enqueueBoletaForPaidBill).toHaveBeenCalledWith(tx, 'bill-1');
    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: { billId: 'bill-1', status: OrderStatus.READY },
      data: { status: OrderStatus.DELIVERED },
    });
    expect(orderItemUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('leaves orders untouched and enqueues no boleta on a partial payment', async () => {
    jest.mocked(enqueueBoletaForPaidBill).mockClear();
    const { tx, orderUpdateMany, orderItemUpdateMany } = buildTx(1000);

    const result = await applyPaymentToBill(
      tx as never,
      'bill-1',
      new Prisma.Decimal(400),
      new Prisma.Decimal(0),
    );

    expect(result.status).toBe('PARTIALLY_PAID');
    expect(enqueueBoletaForPaidBill).not.toHaveBeenCalled();
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(orderItemUpdateMany).not.toHaveBeenCalled();
  });
});

describe('applyPaymentToBill with a bill discount', () => {
  function buildDiscounted() {
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: jest.fn(),
      bill: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'bill-1',
          tableSessionId: 'session-1',
          subtotalAmount: new Prisma.Decimal(1000),
          discountAmount: new Prisma.Decimal(200),
          tipAmount: new Prisma.Decimal(0),
          totalAmount: new Prisma.Decimal(800),
          remainingAmount: new Prisma.Decimal(800),
        }),
        update,
      },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      orderItem: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      tableSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };

    return { tx, update };
  }

  it('closes the bill when the discounted balance is paid', async () => {
    const { tx, update } = buildDiscounted();

    const result = await applyPaymentToBill(
      tx as never,
      'bill-1',
      new Prisma.Decimal(800),
      new Prisma.Decimal(0),
    );

    expect(result.status).toBe('PAID');
    expect(result.discountAmount.toString()).toBe('200');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'bill-1' },
      data: expect.objectContaining({
        totalAmount: new Prisma.Decimal(800),
        remainingAmount: new Prisma.Decimal(0),
      }),
    });
  });

  it('rejects a payment above the discounted balance', async () => {
    const { tx } = buildDiscounted();

    await expect(
      applyPaymentToBill(
        tx as never,
        'bill-1',
        new Prisma.Decimal(900),
        new Prisma.Decimal(0),
      ),
    ).rejects.toThrow('supera el saldo');
  });
});
