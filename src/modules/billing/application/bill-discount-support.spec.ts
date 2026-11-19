import { BillStatus, Prisma } from '@prisma/client';
import { enqueueBoletaForPaidBill } from '../../billing/application/enqueue-boleta';
import {
  writeBillTotals,
  type DiscountBillRecord,
} from './bill-discount-support';

const d = (value: number) => new Prisma.Decimal(value);

jest.mock('../../billing/application/enqueue-boleta');

describe('writeBillTotals', () => {
  it('marks an unpaid bill fully covered by a discount as PAID and settles the session', async () => {
    const bill = {
      id: 'bill-1',
      tableSessionId: 'session-1',
      status: BillStatus.OPEN,
      subtotalAmount: d(10000),
      discountAmount: d(0),
      tipAmount: d(0),
      totalAmount: d(10000),
      remainingAmount: d(10000),
      refundedAmount: d(0),
    } as unknown as DiscountBillRecord;
    const tx = {
      bill: {
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...bill, ...data }),
          ),
      },
      orderItem: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      tableSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };

    const updated = await writeBillTotals(
      tx as unknown as Prisma.TransactionClient,
      bill,
      d(10000),
    );

    expect(updated.status).toBe(BillStatus.PAID);
    expect(updated.remainingAmount.toString()).toBe('0');
    expect(tx.tableSession.updateMany).toHaveBeenCalled();
    expect(enqueueBoletaForPaidBill).toHaveBeenCalledWith(tx, 'bill-1');
  });
});
