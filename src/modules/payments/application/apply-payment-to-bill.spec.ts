import { Prisma } from '@prisma/client';
import { OrderStatus } from '@prisma/client';
import { applyPaymentToBill } from './apply-payment-to-bill';

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
    expect(orderUpdateMany).toHaveBeenCalledWith({
      where: { billId: 'bill-1', status: OrderStatus.READY },
      data: { status: OrderStatus.DELIVERED },
    });
    expect(orderItemUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('leaves orders untouched on a partial payment', async () => {
    const { tx, orderUpdateMany, orderItemUpdateMany } = buildTx(1000);

    const result = await applyPaymentToBill(
      tx as never,
      'bill-1',
      new Prisma.Decimal(400),
      new Prisma.Decimal(0),
    );

    expect(result.status).toBe('PARTIALLY_PAID');
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(orderItemUpdateMany).not.toHaveBeenCalled();
  });
});
