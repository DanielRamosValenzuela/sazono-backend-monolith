import { NotFoundException } from '@nestjs/common';
import {
  PaymentMethod,
  PaymentStatus,
  Prisma,
  RefundMethod,
  RefundReason,
  RefundStatus,
  Role,
} from '@prisma/client';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { ListPaymentRefundsService } from './list-payment-refunds.service';

const d = (value: number | string) => new Prisma.Decimal(value);

const authUser = {
  sub: 'auth-1',
  profileType: LoginProfileType.STAFF,
  profileId: 'staff-1',
  restaurantId: 'restaurant-1',
};

function build(
  roles: Role[],
  payment: Partial<{
    method: PaymentMethod | null;
    provider: string;
    paidAt: Date;
    staffUserId: string | null;
  }> = {},
) {
  const refundRow = {
    id: 'refund-1',
    paymentId: 'payment-1',
    billId: 'bill-1',
    amount: d(3000),
    tipAmount: d(0),
    netAmount: d(2521),
    vatAmount: d(479),
    status: RefundStatus.SUCCEEDED,
    method: RefundMethod.CASH_MANUAL,
    reasonCode: RefundReason.CUSTOMER_COMPLAINT,
    reasonText: 'Plato frio',
    requestedByRole: Role.CASHIER,
    creditNoteStatus: 'PENDING',
    completedAt: new Date('2026-11-20T15:04:05.000Z'),
    createdAt: new Date('2026-11-20T15:04:05.000Z'),
    providerRaw: { secret: true },
    failureReason: 'internal',
    requestFingerprint: 'abc',
    requestedBy: { id: 'staff-1', firstName: 'Caro', lastName: 'Cajera' },
    approvedBy: null,
  };
  const prisma = {
    payment: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'payment-1',
        billId: 'bill-1',
        amount: d(11000),
        tipAmount: d(1000),
        refundedAmount: d(3000),
        refundedTipAmount: d(0),
        provider: payment.provider ?? 'MANUAL',
        method:
          payment.method === undefined ? PaymentMethod.CASH : payment.method,
        status: PaymentStatus.PAID,
        paidAt: payment.paidAt ?? new Date(),
        staffUserId:
          payment.staffUserId === undefined ? 'staff-1' : payment.staffUserId,
        createdAt: new Date(),
        bill: { branch: { restaurant: { timezone: 'America/Santiago' } } },
      }),
    },
    branchSettings: {
      findUnique: jest.fn().mockResolvedValue({
        cashierRefundLimit: d(20000),
        refundTipDefault: true,
      }),
    },
    refund: { findMany: jest.fn().mockResolvedValue([refundRow]) },
  };
  const ensureAccess = jest.fn().mockResolvedValue({
    staffUserId: 'staff-1',
    restaurantId: 'restaurant-1',
    branchId: 'branch-1',
    roles,
  });

  return {
    prisma,
    ensureAccess,
    service: new ListPaymentRefundsService(
      prisma as unknown as PrismaService,
      { ensureAccess } as unknown as BranchAccessService,
    ),
  };
}

describe('ListPaymentRefundsService', () => {
  it('returns the payment state, settings, eligibility and history', async () => {
    const ctx = build([Role.ADMIN]);

    const result = await ctx.service.execute(authUser, 'branch-1', 'payment-1');

    expect(ctx.ensureAccess).toHaveBeenCalledWith(authUser, 'branch-1', [
      Role.ADMIN,
      Role.SUPERVISOR,
      Role.CASHIER,
    ]);
    expect(result.payment).toMatchObject({
      paymentId: 'payment-1',
      billId: 'bill-1',
      method: 'CASH',
      provider: 'MANUAL',
      status: 'PAID',
      amount: '11000',
      tipAmount: '1000',
      consumptionAmount: '10000',
      refundedAmount: '3000',
      refundedTipAmount: '0',
      refundable: { total: '8000', consumption: '7000', tip: '1000' },
    });
    expect(result.settings).toEqual({
      cashierRefundLimit: '20000',
      refundTipDefault: true,
    });
    expect(result.eligibility).toEqual({
      allowed: true,
      method: 'CASH_MANUAL',
      deniedCode: null,
      deniedMessage: null,
      canManageGateway: true,
    });
    expect(result.refunds).toHaveLength(1);
    expect(result.refunds[0]).toMatchObject({
      refundId: 'refund-1',
      netAmount: '2521',
      requestedBy: { name: 'Caro Cajera', role: 'CASHIER' },
    });
  });

  it('never exposes provider raw data or the fingerprint', async () => {
    const ctx = build([Role.ADMIN]);

    const result = await ctx.service.execute(authUser, 'branch-1', 'payment-1');
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('providerRaw');
    expect(serialized).not.toContain('requestFingerprint');
    expect(serialized).not.toContain('secret');
  });

  it('shows a cashier only the refunds he registered', async () => {
    const ctx = build([Role.CASHIER]);

    await ctx.service.execute(authUser, 'branch-1', 'payment-1');

    expect(ctx.prisma.refund.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paymentId: 'payment-1', requestedByStaffUserId: 'staff-1' },
      }),
    );
  });

  it.each([[Role.ADMIN], [Role.SUPERVISOR]])(
    'shows every refund to %s',
    async (role) => {
      const ctx = build([role]);

      await ctx.service.execute(authUser, 'branch-1', 'payment-1');

      expect(ctx.prisma.refund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { paymentId: 'payment-1' } }),
      );
    },
  );

  it('allows a cashier on cash collected today', async () => {
    const ctx = build([Role.CASHIER]);

    const result = await ctx.service.execute(authUser, 'branch-1', 'payment-1');

    expect(result.eligibility.allowed).toBe(true);
  });

  it('denies a cashier a card payment with the admin only code', async () => {
    const ctx = build([Role.CASHIER], { method: PaymentMethod.CREDIT_CARD });

    const result = await ctx.service.execute(authUser, 'branch-1', 'payment-1');

    expect(result.eligibility).toMatchObject({
      allowed: false,
      method: 'MANUAL_EXTERNAL',
      deniedCode: 'REFUND_ADMIN_ONLY',
    });
  });

  it('answers 404 to a cashier for a payment of another day, like the order detail', async () => {
    const ctx = build([Role.CASHIER], {
      paidAt: new Date('2026-01-10T15:00:00.000Z'),
    });

    await expect(
      ctx.service.execute(authUser, 'branch-1', 'payment-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.prisma.refund.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['another cashier', 'staff-2'],
    ['an online payment', null],
  ])(
    'answers 404 to a cashier for a payment collected by %s',
    async (_label, staffUserId) => {
      const ctx = build([Role.CASHIER], { staffUserId });

      await expect(
        ctx.service.execute(authUser, 'branch-1', 'payment-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it.each([[Role.ADMIN], [Role.SUPERVISOR]])(
    'lets %s read a payment of another day and cashier',
    async (role) => {
      const ctx = build([role], {
        paidAt: new Date('2026-01-10T15:00:00.000Z'),
        staffUserId: 'staff-2',
      });

      const result = await ctx.service.execute(
        authUser,
        'branch-1',
        'payment-1',
      );

      expect(result.payment.paymentId).toBe('payment-1');
    },
  );

  it('is read only for a supervisor', async () => {
    const ctx = build([Role.SUPERVISOR]);

    const result = await ctx.service.execute(authUser, 'branch-1', 'payment-1');

    expect(result.eligibility).toEqual({
      allowed: false,
      method: null,
      deniedCode: 'REFUND_ROLE_NOT_ALLOWED',
      deniedMessage: 'Tu rol puede ver los reembolsos pero no registrarlos.',
      canManageGateway: false,
    });
  });

  it('answers 404 for a payment of another branch', async () => {
    const ctx = build([Role.ADMIN]);
    ctx.prisma.payment.findFirst.mockResolvedValue(null);

    await expect(
      ctx.service.execute(authUser, 'branch-1', 'payment-9'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
