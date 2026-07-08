import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  BillStatus,
  PaymentStatus,
  Prisma,
  TableSessionStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { SettleBillPaymentService } from './settle-bill-payment.service';
import type { PaymentProviderPort } from './ports/payment-provider.port';

describe('SettleBillPaymentService', () => {
  const attemptCreateMock = jest.fn();
  const attemptUpdateMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    paymentAttempt: {
      create: attemptCreateMock,
      update: attemptUpdateMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const chargeMock = jest.fn();
  const paymentProvider: PaymentProviderPort = {
    providerName: 'MANUAL',
    charge: chargeMock,
  };

  let service: SettleBillPaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SettleBillPaymentService(prisma, paymentProvider);
  });

  const openBill = {
    id: 'bill-1',
    status: BillStatus.OPEN,
    remainingAmount: new Prisma.Decimal(23600),
    currency: 'CLP',
  };

  it('settles a partial payment with tip and leaves the bill partially paid', async () => {
    attemptCreateMock.mockResolvedValue({ id: 'attempt-1' });
    chargeMock.mockResolvedValue({
      approved: true,
      providerReference: 'manual-ref-1',
    });

    const txAttemptUpdateMock = jest.fn().mockResolvedValue({});
    const txPaymentCreateMock = jest.fn().mockResolvedValue({
      id: 'payment-1',
      billId: 'bill-1',
      amount: new Prisma.Decimal(11000),
      currency: 'CLP',
      provider: 'MANUAL',
      providerReference: 'manual-ref-1',
      status: PaymentStatus.PAID,
      paidAt: new Date('2026-07-07T12:00:00.000Z'),
    });
    const txBillFindUniqueOrThrowMock = jest.fn().mockResolvedValue({
      id: 'bill-1',
      tableSessionId: 'session-1',
      status: BillStatus.OPEN,
      subtotalAmount: new Prisma.Decimal(23600),
      tipAmount: new Prisma.Decimal(0),
      taxAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(23600),
      remainingAmount: new Prisma.Decimal(23600),
    });
    const txBillUpdateMock = jest.fn().mockResolvedValue({});
    const txSessionUpdateManyMock = jest.fn().mockResolvedValue({ count: 0 });

    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          paymentAttempt: { update: txAttemptUpdateMock },
          payment: { create: txPaymentCreateMock },
          bill: {
            findUniqueOrThrow: txBillFindUniqueOrThrowMock,
            update: txBillUpdateMock,
          },
          tableSession: { updateMany: txSessionUpdateManyMock },
        }),
    );
    const result = await service.execute(
      openBill,
      new Prisma.Decimal(10000),
      new Prisma.Decimal(1000),
    );

    expect(result.status).toBe(PaymentStatus.PAID);
    expect(result.bill.status).toBe(BillStatus.PARTIALLY_PAID);
    expect(result.bill.totalAmount).toBe('24600');
    expect(result.bill.remainingAmount).toBe('13600');
    expect(txSessionUpdateManyMock).not.toHaveBeenCalled();
  });

  it('marks the session PAYMENT_COMPLETED when the payment settles the full balance', async () => {
    attemptCreateMock.mockResolvedValue({ id: 'attempt-1' });
    chargeMock.mockResolvedValue({
      approved: true,
      providerReference: 'manual-ref-2',
    });

    const txPaymentCreateMock = jest.fn().mockResolvedValue({
      id: 'payment-1',
      billId: 'bill-1',
      amount: new Prisma.Decimal(23600),
      currency: 'CLP',
      provider: 'MANUAL',
      providerReference: 'manual-ref-2',
      status: PaymentStatus.PAID,
      paidAt: new Date('2026-07-07T12:00:00.000Z'),
    });
    const txBillFindUniqueOrThrowMock = jest.fn().mockResolvedValue({
      id: 'bill-1',
      tableSessionId: 'session-1',
      status: BillStatus.OPEN,
      subtotalAmount: new Prisma.Decimal(23600),
      tipAmount: new Prisma.Decimal(0),
      taxAmount: new Prisma.Decimal(0),
      totalAmount: new Prisma.Decimal(23600),
      remainingAmount: new Prisma.Decimal(23600),
    });
    const txBillUpdateMock = jest.fn().mockResolvedValue({});
    const txSessionUpdateManyMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({ count: 1 });

    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          paymentAttempt: { update: jest.fn().mockResolvedValue({}) },
          payment: { create: txPaymentCreateMock },
          bill: {
            findUniqueOrThrow: txBillFindUniqueOrThrowMock,
            update: txBillUpdateMock,
          },
          tableSession: { updateMany: txSessionUpdateManyMock },
        }),
    );

    const result = await service.execute(
      openBill,
      new Prisma.Decimal(23600),
      new Prisma.Decimal(0),
    );

    expect(result.bill.status).toBe(BillStatus.PAID);
    expect(result.bill.remainingAmount).toBe('0');

    const sessionUpdateArgs = txSessionUpdateManyMock.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(sessionUpdateArgs.where).toMatchObject({ id: 'session-1' });
    expect(sessionUpdateArgs.data).toEqual({
      status: TableSessionStatus.PAYMENT_COMPLETED,
    });
  });

  it('rejects payments above the remaining balance', async () => {
    await expect(
      service.execute(
        openBill,
        new Prisma.Decimal(30000),
        new Prisma.Decimal(0),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(attemptCreateMock).not.toHaveBeenCalled();
  });

  it('rejects payments over a bill that is not payable', async () => {
    await expect(
      service.execute(
        { ...openBill, status: BillStatus.PAID },
        new Prisma.Decimal(1000),
        new Prisma.Decimal(0),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
