import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  BillStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  RefundMethod,
  RefundReason,
  RefundStatus,
  Role,
} from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuthService } from '../../auth/auth.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { CreateRefundDto } from '../presentation/http/dto/refunds.dto';
import { mapRefund, type RefundRecord } from './refund-mapper';
import type { RefundGatewayService } from './refund-gateway.service';
import { RefundPaymentService } from './refund-payment.service';

const d = (value: number | string) => new Prisma.Decimal(value);

type Overrides = {
  roles?: Role[];
  payment?: Partial<{
    amount: Prisma.Decimal;
    tipAmount: Prisma.Decimal;
    refundedAmount: Prisma.Decimal;
    refundedTipAmount: Prisma.Decimal;
    provider: string;
    providerReference: string | null;
    gatewayMeta: Record<string, unknown> | null;
    method: PaymentMethod | null;
    status: PaymentStatus;
    paidAt: Date | null;
    billStatus: BillStatus;
  }>;
  settings?: {
    cashierRefundLimit: Prisma.Decimal | null;
    refundTipDefault: boolean;
    requireOpenCashSession?: boolean;
  } | null;
  orders?: Array<{ id: string; status: OrderStatus }>;
  billItems?: Array<Record<string, unknown>>;
  itemUpdateResult?: number;
  gatewayFinalStatus?: RefundStatus;
  dayTotal?: Prisma.Decimal;
  lockedDayTotal?: Prisma.Decimal;
};

const NOW = new Date('2026-11-20T18:00:00.000Z');

function build(overrides: Overrides = {}) {
  const state = {
    refundedAmount: overrides.payment?.refundedAmount ?? d(0),
    refundedTipAmount: overrides.payment?.refundedTipAmount ?? d(0),
  };
  const paymentBase = {
    id: 'payment-1',
    billId: 'bill-1',
    amount: overrides.payment?.amount ?? d(11000),
    tipAmount: overrides.payment?.tipAmount ?? d(1000),
    provider: overrides.payment?.provider ?? 'MANUAL',
    providerReference: overrides.payment?.providerReference ?? null,
    gatewayMeta: overrides.payment?.gatewayMeta ?? null,
    method:
      overrides.payment?.method === undefined
        ? PaymentMethod.CASH
        : overrides.payment.method,
    status: overrides.payment?.status ?? PaymentStatus.PAID,
    paidAt:
      overrides.payment?.paidAt === undefined
        ? new Date('2026-11-20T15:00:00.000Z')
        : overrides.payment.paidAt,
    createdAt: new Date('2026-11-20T15:00:00.000Z'),
  };
  const currentPayment = () => ({
    ...paymentBase,
    ...state,
    bill: {
      id: 'bill-1',
      status: overrides.payment?.billStatus ?? BillStatus.PAID,
      branchId: 'branch-1',
      branch: { restaurant: { timezone: 'America/Santiago' } },
    },
  });

  const refunds: Array<Record<string, unknown>> = [];
  const auditCreates: Array<{ data: Record<string, unknown> }> = [];
  const cashMovements: Array<{ data: Record<string, unknown> }> = [];
  const orders = overrides.orders ?? [];
  let seq = 0;

  const queryRaw = jest.fn((sql: Prisma.Sql) => {
    if (sql.sql.includes('cash_sessions')) {
      return Promise.resolve([]);
    }

    if (sql.sql.includes('FROM bills')) {
      return Promise.resolve([{ '?column?': 1 }]);
    }

    const [amount, tip] = sql.values as [string, string];
    const nextAmount = state.refundedAmount.add(amount);
    const nextTip = state.refundedTipAmount.add(tip);
    const consumptionNext = nextAmount.sub(nextTip);
    const fits =
      paymentBase.status === PaymentStatus.PAID &&
      nextAmount.lte(paymentBase.amount) &&
      nextTip.lte(paymentBase.tipAmount) &&
      consumptionNext.lte(paymentBase.amount.sub(paymentBase.tipAmount));

    if (!fits) {
      return Promise.resolve([]);
    }

    state.refundedAmount = nextAmount;
    state.refundedTipAmount = nextTip;

    return Promise.resolve([
      {
        refunded_amount: state.refundedAmount,
        refunded_tip_amount: state.refundedTipAmount,
      },
    ]);
  });

  let billRefunded = d(0);

  const tx = {
    $queryRaw: queryRaw,
    $executeRaw: jest.fn().mockResolvedValue(overrides.itemUpdateResult ?? 1),
    refund: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: {
          amount: overrides.lockedDayTotal ?? overrides.dayTotal ?? null,
        },
      }),
      create: jest.fn(
        ({
          data,
        }: {
          data: Record<string, unknown> & {
            items?: { create: Record<string, unknown>[] };
          };
        }) => {
          const duplicate = refunds.find(
            (row) => row.idempotencyKey === data.idempotencyKey,
          );

          if (duplicate) {
            throw new Prisma.PrismaClientKnownRequestError('dup', {
              code: 'P2002',
              clientVersion: 'test',
            });
          }

          seq += 1;
          const row = {
            id: `refund-${seq}`,
            createdAt: NOW,
            updatedAt: NOW,
            requestedBy: {
              id: data.requestedByStaffUserId,
              firstName: 'Caro',
              lastName: 'Cajera',
            },
            approvedBy: data.approvedByStaffUserId
              ? {
                  id: data.approvedByStaffUserId,
                  firstName: 'Ada',
                  lastName: 'Admin',
                }
              : null,
            ...data,
            items: (data.items?.create ?? []).map(
              (item: Record<string, unknown>, index: number) => ({
                id: `ri-${index}`,
                ...item,
              }),
            ),
          };
          refunds.push(row);
          return Promise.resolve(row);
        },
      ),
    },
    bill: {
      update: jest.fn(
        ({
          data,
        }: {
          data: { refundedAmount: { increment: Prisma.Decimal } };
        }) => {
          billRefunded = billRefunded.add(data.refundedAmount.increment);
          return Promise.resolve({ refundedAmount: billRefunded });
        },
      ),
    },
    cashMovement: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        cashMovements.push(args);
        return Promise.resolve({ id: `cash-${cashMovements.length}` });
      }),
    },
    order: { findMany: jest.fn().mockResolvedValue(orders) },
    auditLog: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        auditCreates.push(args);
        return Promise.resolve({});
      }),
    },
  };

  const prisma = {
    payment: {
      findFirst: jest.fn(() => Promise.resolve(currentPayment())),
      findUniqueOrThrow: jest.fn(() => Promise.resolve(currentPayment())),
    },
    billItem: {
      findMany: jest.fn().mockResolvedValue(overrides.billItems ?? []),
    },
    branchSettings: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          overrides.settings === undefined
            ? { cashierRefundLimit: null, refundTipDefault: false }
            : overrides.settings,
        ),
    },
    refund: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: { paymentId_idempotencyKey: { idempotencyKey: string } };
        }) =>
          Promise.resolve(
            refunds.find(
              (row) =>
                row.idempotencyKey ===
                where.paymentId_idempotencyKey.idempotencyKey,
            ) ?? null,
          ),
      ),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { amount: overrides.dayTotal ?? null } }),
    },
    auditLog: {
      count: jest.fn().mockResolvedValue(0),
      create: tx.auditLog.create,
    },
    staffUserBranchRole: {
      findFirst: jest.fn(),
      findMany: jest
        .fn()
        .mockResolvedValue([
          { staffUser: { id: 'admin-1', firstName: 'Ada', lastName: 'Admin' } },
        ]),
    },
    order: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };

  const ensureAccess = jest.fn().mockResolvedValue({
    staffUserId: 'staff-1',
    restaurantId: 'restaurant-1',
    branchId: 'branch-1',
    roles: overrides.roles ?? [Role.CASHIER],
  });
  const verifyStaffPin = jest.fn().mockResolvedValue('OK');

  const dispatch = jest.fn((id: string) => {
    const row = refunds.find((item) => item.id === id);

    if (row && overrides.gatewayFinalStatus) {
      row.status = overrides.gatewayFinalStatus;
    }

    return Promise.resolve(row);
  });
  const toResult = jest.fn((refund: Record<string, unknown>, replay: boolean) =>
    Promise.resolve({
      refund: mapRefund(refund as unknown as RefundRecord),
      payment: {} as never,
      cashToHandOver: null,
      billActiveOrders: 0,
      idempotentReplay: replay,
    }),
  );
  const refundGateway = {
    dispatch,
    toResult,
  } as unknown as RefundGatewayService;

  const service = new RefundPaymentService(
    prisma as unknown as PrismaService,
    { ensureAccess } as unknown as BranchAccessService,
    { verifyStaffPin } as unknown as AuthService,
    new AuditService(prisma as unknown as PrismaService),
    refundGateway,
  );

  return {
    service,
    dispatch,
    toResult,
    prisma,
    tx,
    refunds,
    auditCreates,
    cashMovements,
    ensureAccess,
    verifyStaffPin,
    queryRaw,
    state,
  };
}

const authUser = {
  sub: 'auth-1',
  profileType: LoginProfileType.STAFF,
  profileId: 'staff-1',
  restaurantId: 'restaurant-1',
};

const meta = { ip: '10.0.0.1', userAgent: 'jest' };

const dto = (overrides: Partial<CreateRefundDto> = {}): CreateRefundDto => ({
  amount: '3000',
  reasonCode: RefundReason.CUSTOMER_COMPLAINT,
  reasonText: 'Plato frio',
  ...overrides,
});

const run = (
  ctx: ReturnType<typeof build>,
  body: CreateRefundDto = dto(),
  key = 'key-aaaa-0001',
) => ctx.service.execute(authUser, 'branch-1', 'payment-1', key, body, meta);

const actions = (ctx: ReturnType<typeof build>) =>
  ctx.auditCreates.map((call) => call.data.action);

const codeOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  const response = (
    error as { getResponse?: () => unknown } | null
  )?.getResponse?.() as { code?: string } | undefined;

  return { error, code: response?.code };
};

describe('RefundPaymentService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('cash refunds', () => {
    it('refunds the full payment with a cash movement, bill increment and audit', async () => {
      const ctx = build({
        orders: [
          { id: 'o1', status: OrderStatus.IN_PREPARATION },
          { id: 'o2', status: OrderStatus.DELIVERED },
        ],
      });

      const result = await run(ctx, dto({ amount: '11000', refundTip: true }));

      expect(result.idempotentReplay).toBe(false);
      expect(result.cashToHandOver).toBe('11000');
      expect(result.billActiveOrders).toBe(1);
      expect(result.refund).toMatchObject({
        amount: '11000',
        tipAmount: '1000',
        consumptionAmount: '10000',
        netAmount: '8403',
        vatAmount: '1597',
        status: RefundStatus.SUCCEEDED,
        method: RefundMethod.CASH_MANUAL,
        creditNoteStatus: 'PENDING',
        requestedBy: {
          staffUserId: 'staff-1',
          name: 'Caro Cajera',
          role: 'CASHIER',
        },
        approvedBy: null,
        items: [],
      });
      expect(result.payment.refundable).toEqual({
        total: '0',
        consumption: '0',
        tip: '0',
      });

      expect(ctx.tx.refund.create).toHaveBeenCalledTimes(1);
      const created = (
        ctx.tx.refund.create.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(created).toMatchObject({
        restaurantId: 'restaurant-1',
        branchId: 'branch-1',
        billId: 'bill-1',
        paymentId: 'payment-1',
        status: RefundStatus.SUCCEEDED,
        provider: 'MANUAL',
        requestedByRole: Role.CASHIER,
        approvedByStaffUserId: null,
        source: 'STAFF',
        idempotencyKey: 'key-aaaa-0001',
        reasonText: 'Plato frio',
      });
      expect(created.requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(created.completedAt).toEqual(NOW);

      expect(ctx.cashMovements).toHaveLength(1);
      expect(ctx.cashMovements[0].data).toMatchObject({
        type: 'REFUND_OUT',
        branchId: 'branch-1',
        paymentId: 'payment-1',
        refundId: 'refund-1',
        staffUserId: 'staff-1',
        reason: 'Plato frio',
      });
      expect(
        (ctx.cashMovements[0].data.amount as Prisma.Decimal).toString(),
      ).toBe('-11000');

      expect(ctx.tx.bill.update).toHaveBeenCalledWith({
        where: { id: 'bill-1' },
        data: { refundedAmount: { increment: d(11000) } },
        select: { refundedAmount: true },
      });

      expect(actions(ctx)).toEqual(['REFUND_SUCCEEDED']);
      const audit = ctx.auditCreates[0].data;
      expect(audit).toMatchObject({
        actorStaffUserId: 'staff-1',
        actorRole: Role.CASHIER,
        entityType: 'Refund',
        entityId: 'refund-1',
        reason: 'Plato frio',
        ip: '10.0.0.1',
        userAgent: 'jest',
      });
      expect(audit.after).toMatchObject({
        billRefundedAmount: '11000',
        cashMovementId: 'cash-1',
        orders: [
          { id: 'o1', status: 'IN_PREPARATION' },
          { id: 'o2', status: 'DELIVERED' },
        ],
      });
      expect(audit.before).toMatchObject({
        paymentRefundedAmount: '0',
        billRefundedAmount: '0',
      });
    });

    it('calls ensureAccess for ADMIN and CASHIER with a fresh lookup', async () => {
      const ctx = build();
      await run(ctx);

      expect(ctx.ensureAccess).toHaveBeenCalledWith(
        authUser,
        'branch-1',
        [Role.ADMIN, Role.CASHIER],
        { fresh: true },
      );
    });

    it('never touches the bill status, remaining amount or payment status', async () => {
      const ctx = build();
      await run(ctx);

      const billData = (
        ctx.tx.bill.update.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(Object.keys(billData)).toEqual(['refundedAmount']);
      expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('accumulates partial refunds until the payment is empty', async () => {
      const ctx = build();

      const first = await run(ctx, dto({ amount: '3000' }), 'key-aaaa-0001');
      const second = await run(ctx, dto({ amount: '7000' }), 'key-aaaa-0002');

      expect(first.payment.refundable.consumption).toBe('7000');
      expect(second.payment.refundedAmount).toBe('10000');
      expect(second.payment.refundable).toEqual({
        total: '1000',
        consumption: '0',
        tip: '1000',
      });
      expect(second.refund.netAmount).toBe('5882');
      expect(
        Number(first.refund.netAmount) + Number(second.refund.netAmount),
      ).toBe(8403);

      const third = await run(
        ctx,
        dto({ amount: '1000', refundTip: true }),
        'key-aaaa-0003',
      );
      expect(third.refund).toMatchObject({
        tipAmount: '1000',
        consumptionAmount: '0',
        netAmount: '0',
        vatAmount: '0',
        creditNoteStatus: 'NOT_REQUIRED',
      });
    });

    it('rejects an amount above the refundable with the refundable in the body', async () => {
      const ctx = build({
        payment: { refundedAmount: d(3000), refundedTipAmount: d(0) },
      });

      const { error, code } = await codeOf(run(ctx, dto({ amount: '8001' })));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(code).toBe('REFUND_EXCEEDS_REFUNDABLE');
      expect(
        (error as BadRequestException).getResponse() as { refundable: unknown },
      ).toMatchObject({
        refundable: { total: '8000', consumption: '7000', tip: '1000' },
      });
      expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('requires an open cash session for a cash refund when the branch demands it', async () => {
      const ctx = build({
        settings: {
          cashierRefundLimit: null,
          refundTipDefault: false,
          requireOpenCashSession: true,
        },
      });

      const { code } = await codeOf(run(ctx));

      expect(code).toBe('CASH_SESSION_REQUIRED');
      expect(ctx.cashMovements).toHaveLength(0);
    });

    it('rejects a zero amount', async () => {
      const ctx = build();
      const { error, code } = await codeOf(run(ctx, dto({ amount: '0.00' })));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(code).toBe('REFUND_AMOUNT_INVALID');
    });

    it('keeps the cash movements equal to minus the cash refunds', async () => {
      const ctx = build();
      await run(ctx, dto({ amount: '2500' }), 'key-aaaa-0001');
      await run(ctx, dto({ amount: '4500' }), 'key-aaaa-0002');
      await run(
        ctx,
        dto({ amount: '1000', refundTip: true, tipAmount: '1000' }),
        'key-aaaa-0003',
      );

      const cashRefunds = ctx.refunds
        .filter((row) => row.method === RefundMethod.CASH_MANUAL)
        .reduce((sum, row) => sum.add(row.amount as Prisma.Decimal), d(0));
      const movements = ctx.cashMovements.reduce(
        (sum, call) => sum.add(call.data.amount as Prisma.Decimal),
        d(0),
      );

      expect(movements.toString()).toBe(cashRefunds.neg().toString());
      expect(cashRefunds.toString()).toBe('8000');
    });

    it.each([
      BillStatus.OPEN,
      BillStatus.PARTIALLY_PAID,
      BillStatus.ABANDONED,
      BillStatus.VOID,
    ])('refunds a PAID payment of a %s bill', async (billStatus) => {
      const ctx = build({ payment: { billStatus } });

      const result = await run(ctx);

      expect(result.refund.status).toBe(RefundStatus.SUCCEEDED);
      expect(ctx.tx.bill.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('tip rules', () => {
    it('does not refund the tip by default', async () => {
      const ctx = build();
      const result = await run(ctx, dto({ amount: '3000' }));

      expect(result.refund.tipAmount).toBe('0');
    });

    it('uses the branch default when refundTip is omitted', async () => {
      const ctx = build({
        settings: { cashierRefundLimit: null, refundTipDefault: true },
      });
      const result = await run(ctx, dto({ amount: '3000' }));

      expect(result.refund).toMatchObject({
        tipAmount: '273',
        consumptionAmount: '2727',
      });
    });

    it('lets an explicit false override the branch default', async () => {
      const ctx = build({
        settings: { cashierRefundLimit: null, refundTipDefault: true },
      });
      const result = await run(ctx, dto({ amount: '3000', refundTip: false }));

      expect(result.refund.tipAmount).toBe('0');
    });

    it('accepts an editable tip amount', async () => {
      const ctx = build();
      const result = await run(
        ctx,
        dto({ amount: '3000', refundTip: true, tipAmount: '500' }),
      );

      expect(result.refund).toMatchObject({
        tipAmount: '500',
        consumptionAmount: '2500',
      });
    });

    it('rejects an explicit tip without refundTip', async () => {
      const ctx = build();
      const { code } = await codeOf(
        run(ctx, dto({ refundTip: false, tipAmount: '500' })),
      );

      expect(code).toBe('REFUND_TIP_NOT_ALLOWED');
    });

    it('rejects a tip above the remaining tip', async () => {
      const ctx = build();
      const { code } = await codeOf(
        run(ctx, dto({ refundTip: true, tipAmount: '1500' })),
      );

      expect(code).toBe('REFUND_EXCEEDS_REFUNDABLE');
    });

    it('creates a tip-only refund with net zero', async () => {
      const ctx = build();
      const result = await run(
        ctx,
        dto({ amount: '500', refundTip: true, tipAmount: '500' }),
      );

      expect(result.refund).toMatchObject({
        netAmount: '0',
        vatAmount: '0',
        consumptionAmount: '0',
        creditNoteStatus: 'NOT_REQUIRED',
      });
    });
  });

  describe('idempotency', () => {
    it('returns the same refund for the same key, requester and body without a transaction', async () => {
      const ctx = build();
      const first = await run(ctx);
      ctx.prisma.$transaction.mockClear();
      ctx.auditCreates.length = 0;

      const replay = await run(ctx);

      expect(replay.idempotentReplay).toBe(true);
      expect(replay.refund.refundId).toBe(first.refund.refundId);
      expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
      expect(ctx.auditCreates).toHaveLength(0);
      expect(ctx.refunds).toHaveLength(1);
    });

    it.each([
      ['another amount', dto({ amount: '2000' })],
      ['another reason code', dto({ reasonCode: RefundReason.OTHER })],
      ['another reason text', dto({ reasonText: 'Otra cosa' })],
      ['another tip', dto({ refundTip: true })],
    ])('answers 409 when the key is reused with %s', async (_label, body) => {
      const ctx = build();
      await run(ctx);

      const { error, code } = await codeOf(run(ctx, body));

      expect(error).toBeInstanceOf(ConflictException);
      expect(code).toBe('REFUND_IDEMPOTENCY_KEY_REUSED');
      expect(
        JSON.stringify((error as ConflictException).getResponse()),
      ).not.toContain('refund-1');
    });

    it('replays a committed refund after the cashier day lapsed', async () => {
      const ctx = build();
      const first = await run(ctx);
      jest.setSystemTime(new Date('2026-11-21T04:00:00.000Z'));

      const replay = await run(ctx);

      expect(replay.idempotentReplay).toBe(true);
      expect(replay.refund.refundId).toBe(first.refund.refundId);
      expect(ctx.refunds).toHaveLength(1);
    });

    it('answers 409 when the branch default tip changed between attempts', async () => {
      const ctx = build();
      await run(ctx);
      ctx.prisma.branchSettings.findUnique.mockResolvedValue({
        cashierRefundLimit: null,
        refundTipDefault: true,
      });

      const { code } = await codeOf(run(ctx));

      expect(code).toBe('REFUND_IDEMPOTENCY_KEY_REUSED');
    });

    it('answers 409 when another requester reuses the key', async () => {
      const ctx = build();
      await run(ctx);
      ctx.ensureAccess.mockResolvedValue({
        staffUserId: 'staff-2',
        restaurantId: 'restaurant-1',
        branchId: 'branch-1',
        roles: [Role.CASHIER],
      });

      const { code } = await codeOf(run(ctx));

      expect(code).toBe('REFUND_IDEMPOTENCY_KEY_REUSED');
    });

    it('replays to the same requester even when the role lapsed to cashier on a manual external payment', async () => {
      const ctx = build({
        roles: [Role.ADMIN],
        payment: {
          provider: 'MERCADO_PAGO',
          method: PaymentMethod.MERCADO_PAGO,
        },
      });
      await run(ctx);
      ctx.ensureAccess.mockResolvedValue({
        staffUserId: 'staff-1',
        restaurantId: 'restaurant-1',
        branchId: 'branch-1',
        roles: [Role.CASHIER],
      });

      const replay = await run(ctx);

      expect(replay.idempotentReplay).toBe(true);
      expect(ctx.refunds).toHaveLength(1);
    });

    it('answers the existing refund when the insert hits the unique key', async () => {
      const ctx = build();
      const original = await run(ctx);
      const stored = ctx.refunds[0];
      ctx.prisma.refund.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValue(stored);

      const replay = await run(ctx);

      expect(replay.idempotentReplay).toBe(true);
      expect(replay.refund.refundId).toBe(original.refund.refundId);
    });

    it('loses the conditional update without writing anything and answers 409', async () => {
      const ctx = build();
      ctx.queryRaw.mockResolvedValueOnce([]);

      const { error, code } = await codeOf(run(ctx));

      expect(error).toBeInstanceOf(ConflictException);
      expect(code).toBe('REFUND_CONFLICT');
      expect(ctx.tx.refund.create).not.toHaveBeenCalled();
      expect(ctx.tx.cashMovement.create).not.toHaveBeenCalled();
      expect(ctx.tx.bill.update).not.toHaveBeenCalled();
      expect(ctx.auditCreates).toHaveLength(0);
    });

    it('loses the conditional update but replays when the same key already committed', async () => {
      const ctx = build();
      const original = await run(ctx);
      ctx.queryRaw.mockResolvedValueOnce([]);
      ctx.prisma.refund.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValue(ctx.refunds[0]);

      const replay = await run(ctx);

      expect(replay.idempotentReplay).toBe(true);
      expect(replay.refund.refundId).toBe(original.refund.refundId);
    });

    it('serializes two requests for the last balance: the second sees the updated row', async () => {
      const ctx = build({ payment: { amount: d(10000), tipAmount: d(0) } });

      const first = await run(ctx, dto({ amount: '6000' }), 'key-aaaa-0001');
      const second = await codeOf(
        run(ctx, dto({ amount: '6000' }), 'key-aaaa-0002'),
      );

      expect(first.refund.status).toBe(RefundStatus.SUCCEEDED);
      expect(second.code).toBe('REFUND_EXCEEDS_REFUNDABLE');

      ctx.state.refundedAmount = d(0);
      const stale = build({ payment: { amount: d(10000), tipAmount: d(0) } });
      await run(stale, dto({ amount: '6000' }), 'key-aaaa-0001');
      stale.prisma.payment.findFirst.mockResolvedValueOnce({
        id: 'payment-1',
        billId: 'bill-1',
        amount: d(10000),
        tipAmount: d(0),
        refundedAmount: d(0),
        refundedTipAmount: d(0),
        provider: 'MANUAL',
        providerReference: null,
        gatewayMeta: null,
        method: PaymentMethod.CASH,
        status: PaymentStatus.PAID,
        paidAt: new Date('2026-11-20T15:00:00.000Z'),
        createdAt: new Date('2026-11-20T15:00:00.000Z'),
        bill: {
          id: 'bill-1',
          status: BillStatus.PAID,
          branchId: 'branch-1',
          branch: { restaurant: { timezone: 'America/Santiago' } },
        },
      });
      const loser = await codeOf(
        run(stale, dto({ amount: '6000' }), 'key-aaaa-0002'),
      );

      expect(loser.code).toBe('REFUND_CONFLICT');
      expect(stale.refunds).toHaveLength(1);
    });
  });

  describe('modes and roles', () => {
    it('stops when ensureAccess rejects the role', async () => {
      const ctx = build();
      ctx.ensureAccess.mockRejectedValue(new ForbiddenException('nope'));

      await expect(run(ctx)).rejects.toBeInstanceOf(ForbiddenException);
      expect(ctx.prisma.payment.findFirst).not.toHaveBeenCalled();
      expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('answers 404 when the payment is not in the branch', async () => {
      const ctx = build();
      ctx.prisma.payment.findFirst.mockResolvedValue(null as never);

      const { error, code } = await codeOf(run(ctx));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(code).toBe('PAYMENT_NOT_FOUND');
      expect(ctx.prisma.payment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payment-1', bill: { branchId: 'branch-1' } },
        }),
      );
    });

    it('answers 409 for a payment that is not PAID', async () => {
      const ctx = build({ payment: { status: PaymentStatus.PENDING } });
      const { error, code } = await codeOf(run(ctx));

      expect(error).toBeInstanceOf(ConflictException);
      expect(code).toBe('REFUND_PAYMENT_NOT_PAID');
    });

    it('denies a cashier a non cash payment and audits the denial', async () => {
      const ctx = build({ payment: { method: PaymentMethod.CREDIT_CARD } });

      const { error, code } = await codeOf(run(ctx));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(code).toBe('REFUND_ADMIN_ONLY');
      expect(actions(ctx)).toEqual(['REFUND_DENIED']);
      expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('denies a cashier a cash payment of another day in the restaurant timezone', async () => {
      jest.setSystemTime(new Date('2026-11-21T03:30:00.000Z'));
      const ctx = build({
        payment: { paidAt: new Date('2026-11-21T02:30:00.000Z') },
      });

      const { code } = await codeOf(run(ctx));

      expect(code).toBe('REFUND_CASHIER_DAY_LIMIT');
      expect(actions(ctx)).toEqual(['REFUND_DENIED']);
    });

    it('lets a cashier refund cash paid 23:30 Santiago while it is still the same local day', async () => {
      jest.setSystemTime(new Date('2026-11-21T02:50:00.000Z'));
      const ctx = build({
        payment: { paidAt: new Date('2026-11-21T02:30:00.000Z') },
      });

      const result = await run(ctx);

      expect(result.refund.status).toBe(RefundStatus.SUCCEEDED);
    });

    it('lets an admin register a Mercado Pago payment as manual external without cash movement', async () => {
      const ctx = build({
        roles: [Role.ADMIN],
        payment: {
          provider: 'MERCADO_PAGO',
          method: PaymentMethod.MERCADO_PAGO,
          paidAt: new Date('2026-10-01T15:00:00.000Z'),
        },
      });

      const result = await run(ctx);

      expect(result.refund.method).toBe(RefundMethod.MANUAL_EXTERNAL);
      expect(result.cashToHandOver).toBeNull();
      expect(ctx.cashMovements).toHaveLength(0);
      expect(actions(ctx)).toEqual(['REFUND_REGISTERED_MANUAL']);
      expect(ctx.auditCreates[0].data.after).toMatchObject({
        provider: 'MERCADO_PAGO',
        gatewayRefundDoneOutsideSazono: true,
      });
      expect(ctx.auditCreates[0].data.actorRole).toBe(Role.ADMIN);
    });

    it('treats an unclassified historical payment as manual external, admin only', async () => {
      const admin = build({ roles: [Role.ADMIN], payment: { method: null } });
      expect((await run(admin)).refund.method).toBe(
        RefundMethod.MANUAL_EXTERNAL,
      );

      const cashier = build({ payment: { method: null } });
      expect((await codeOf(run(cashier))).code).toBe('REFUND_ADMIN_ONLY');
    });

    it('saves the effective role as ADMIN when the user holds both roles', async () => {
      const ctx = build({ roles: [Role.CASHIER, Role.ADMIN] });
      await run(ctx);

      const created = (
        ctx.tx.refund.create.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(created.requestedByRole).toBe(Role.ADMIN);
    });
  });

  describe('cashier daily limit and approval', () => {
    const limited = (limit: number) => ({
      cashierRefundLimit: d(limit),
      refundTipDefault: false,
    });

    it('does not require approval without a limit', async () => {
      const ctx = build({ settings: null });
      await run(ctx, dto({ amount: '10000' }));

      expect(ctx.prisma.refund.aggregate).not.toHaveBeenCalled();
    });

    it('does not require approval under the limit and sums the day of the cashier', async () => {
      const ctx = build({ settings: limited(20000), dayTotal: d(10000) });
      await run(ctx, dto({ amount: '5000' }));

      const args = ctx.prisma.refund.aggregate.mock.calls[0] as [
        {
          where: {
            requestedByStaffUserId: string;
            approvedByStaffUserId: null;
            status: string;
            completedAt: { gte: Date; lt: Date };
          };
        },
      ];
      expect(args[0].where).toMatchObject({
        requestedByStaffUserId: 'staff-1',
        approvedByStaffUserId: null,
        status: RefundStatus.SUCCEEDED,
      });
      expect(args[0].where.completedAt.gte.toISOString()).toBe(
        '2026-11-20T03:00:00.000Z',
      );
      expect(args[0].where.completedAt.lt.toISOString()).toBe(
        '2026-11-21T03:00:00.000Z',
      );
    });

    it('asks for approval above the accumulated limit and audits the denial', async () => {
      const ctx = build({ settings: limited(20000), dayTotal: d(19999) });

      const { error, code } = await codeOf(run(ctx, dto({ amount: '2' })));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(code).toBe('REFUND_NEEDS_APPROVAL');
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        limit: '20000',
        dayRefunded: '19999',
        requiredTotal: '20001',
        approvers: [{ staffUserId: 'admin-1', name: 'Ada Admin' }],
      });
      expect(actions(ctx)).toEqual(['REFUND_DENIED']);
      expect(ctx.auditCreates[0].data.after).toMatchObject({
        code: 'REFUND_NEEDS_APPROVAL',
        limit: '20000',
        requiredTotal: '20001',
      });
      expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('approves with a valid admin PIN and audits the approval', async () => {
      const ctx = build({ settings: limited(2000), dayTotal: d(0) });
      ctx.prisma.staffUserBranchRole.findFirst.mockResolvedValue({
        staffUser: {
          id: 'admin-1',
          pinHash: 'hash',
          pinFailedAttempts: 0,
          pinLockedUntil: null,
          approvalPinFailedAttempts: 0,
          approvalPinLockedUntil: null,
        },
      });

      const result = await run(
        ctx,
        dto({
          amount: '3000',
          approverStaffUserId: 'admin-1',
          approverPin: '1234',
        }),
      );

      expect(ctx.verifyStaffPin).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'admin-1' }),
        '1234',
        'APPROVAL',
      );
      expect(result.refund.approvedBy).toEqual({
        staffUserId: 'admin-1',
        name: 'Ada Admin',
      });
      expect(actions(ctx)).toEqual(['REFUND_SUCCEEDED', 'REFUND_APPROVED']);
      expect(ctx.auditCreates[1].data).toMatchObject({
        actorStaffUserId: 'admin-1',
        actorRole: Role.ADMIN,
      });

      const serialized = JSON.stringify([
        ctx.auditCreates,
        ctx.tx.refund.create.mock.calls,
      ]);
      expect(serialized).not.toContain('1234');
    });

    it('rejects a wrong PIN, audits the failure and never opens a transaction', async () => {
      const ctx = build({ settings: limited(2000) });
      ctx.prisma.staffUserBranchRole.findFirst.mockResolvedValue({
        staffUser: { id: 'admin-1', pinHash: 'hash' },
      });
      ctx.verifyStaffPin.mockResolvedValue('INVALID');

      const { code } = await codeOf(
        run(
          ctx,
          dto({
            amount: '3000',
            approverStaffUserId: 'admin-1',
            approverPin: '0000',
          }),
        ),
      );

      expect(code).toBe('REFUND_PIN_INVALID');
      expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
      expect(actions(ctx)).toEqual(['REFUND_APPROVAL_FAILED']);
      expect(ctx.auditCreates[0].data).toMatchObject({
        actorStaffUserId: 'staff-1',
        entityType: 'StaffUser',
        entityId: 'admin-1',
        after: { paymentId: 'payment-1', reason: 'INVALID' },
      });
      expect(JSON.stringify(ctx.auditCreates)).not.toContain('0000');
    });

    it('rejects a locked approver PIN', async () => {
      const ctx = build({ settings: limited(2000) });
      ctx.prisma.staffUserBranchRole.findFirst.mockResolvedValue({
        staffUser: { id: 'admin-1', pinHash: 'hash' },
      });
      ctx.verifyStaffPin.mockResolvedValue('LOCKED');

      const { code } = await codeOf(
        run(
          ctx,
          dto({
            amount: '3000',
            approverStaffUserId: 'admin-1',
            approverPin: '1234',
          }),
        ),
      );

      expect(code).toBe('REFUND_PIN_LOCKED');
      expect(ctx.auditCreates[0].data.after).toMatchObject({
        reason: 'LOCKED',
      });
    });

    it('blocks the requester after five failed approvals in 15 minutes before checking the PIN', async () => {
      const ctx = build({ settings: limited(2000) });
      ctx.prisma.auditLog.count.mockResolvedValue(5);

      const { code } = await codeOf(
        run(
          ctx,
          dto({
            amount: '3000',
            approverStaffUserId: 'admin-1',
            approverPin: '1234',
          }),
        ),
      );

      expect(code).toBe('REFUND_APPROVAL_BLOCKED');
      expect(ctx.verifyStaffPin).not.toHaveBeenCalled();
      expect(ctx.prisma.auditLog.count).toHaveBeenCalledWith({
        where: {
          actorStaffUserId: 'staff-1',
          action: 'REFUND_APPROVAL_FAILED',
          createdAt: { gte: new Date(NOW.getTime() - 15 * 60 * 1000) },
        },
      });
    });

    it.each([
      ['not an active admin of the branch', null],
      ['an admin without PIN', { staffUser: { id: 'admin-1', pinHash: null } }],
      [
        'the requester himself',
        { staffUser: { id: 'staff-1', pinHash: 'hash' } },
      ],
    ])('rejects %s as approver', async (_label, found) => {
      const ctx = build({ settings: limited(2000) });
      ctx.prisma.staffUserBranchRole.findFirst.mockResolvedValue(found);

      const { code } = await codeOf(
        run(
          ctx,
          dto({
            amount: '3000',
            approverStaffUserId: 'admin-1',
            approverPin: '1234',
          }),
        ),
      );

      expect(code).toBe('REFUND_APPROVER_INVALID');
      expect(ctx.verifyStaffPin).not.toHaveBeenCalled();
    });

    it('lets an admin ignore the limit and the approver fields', async () => {
      const ctx = build({
        roles: [Role.ADMIN],
        settings: limited(1),
        payment: { method: PaymentMethod.CASH },
      });

      const result = await run(
        ctx,
        dto({
          amount: '5000',
          approverStaffUserId: 'admin-1',
          approverPin: '1234',
        }),
      );

      expect(result.refund.approvedBy).toBeNull();
      expect(ctx.prisma.refund.aggregate).not.toHaveBeenCalled();
      expect(ctx.verifyStaffPin).not.toHaveBeenCalled();
    });

    it('does not count approved refunds toward the day total (query shape)', async () => {
      const ctx = build({ settings: limited(100000) });
      await run(ctx);

      const where = (
        ctx.prisma.refund.aggregate.mock.calls[0] as [
          { where: Record<string, unknown> },
        ]
      )[0].where;
      expect(where.approvedByStaffUserId).toBeNull();
    });

    it('takes a per cashier lock and rechecks the day total inside the transaction', async () => {
      const ctx = build({ settings: limited(20000), dayTotal: d(0) });
      await run(ctx, dto({ amount: '5000' }));

      const lock = ctx.tx.$executeRaw.mock.calls[0] as [Prisma.Sql];
      expect(lock[0].sql).toContain('pg_advisory_xact_lock');
      expect(lock[0].values).toEqual(['refund-limit:staff-1:branch-1']);
      expect(ctx.tx.refund.aggregate).toHaveBeenCalledTimes(1);
      expect(ctx.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        ctx.tx.refund.aggregate.mock.invocationCallOrder[0],
      );
    });

    it('does not lock for admins nor for approved refunds', async () => {
      const admin = build({
        roles: [Role.ADMIN],
        settings: limited(1),
        payment: { method: PaymentMethod.CASH },
      });
      await run(admin);
      expect(admin.tx.$executeRaw).not.toHaveBeenCalled();

      const approved = build({
        settings: limited(1000),
        dayTotal: d(0),
      });
      approved.prisma.staffUserBranchRole.findFirst.mockResolvedValue({
        staffUser: {
          id: 'admin-1',
          pinHash: 'hash',
          pinFailedAttempts: 0,
          pinLockedUntil: null,
          approvalPinFailedAttempts: 0,
          approvalPinLockedUntil: null,
        },
      });
      await run(
        approved,
        dto({
          amount: '3000',
          approverStaffUserId: 'admin-1',
          approverPin: '1234',
        }),
      );
      expect(approved.tx.$executeRaw).not.toHaveBeenCalled();
    });

    it('asks for approval when a parallel refund pushed the locked day total over the limit', async () => {
      const ctx = build({
        settings: limited(20000),
        dayTotal: d(0),
        lockedDayTotal: d(19999),
      });

      const { error, code } = await codeOf(
        run(ctx, dto({ amount: '3000' }), 'key-aaaa-0002'),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(code).toBe('REFUND_NEEDS_APPROVAL');
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        limit: '20000',
        dayRefunded: '19999',
        requiredTotal: '22999',
      });
      expect(ctx.refunds).toHaveLength(0);
      expect(ctx.queryRaw).not.toHaveBeenCalled();
      expect(actions(ctx)).toEqual(['REFUND_DENIED']);
    });
  });

  describe('gateway refunds', () => {
    const gatewayPayment = {
      provider: 'MERCADO_PAGO',
      method: PaymentMethod.MERCADO_PAGO,
      providerReference: 'ORD01',
    };

    it('reserves the balance, creates a PENDING GATEWAY refund and dispatches it outside the transaction', async () => {
      const ctx = build({
        roles: [Role.ADMIN],
        payment: gatewayPayment,
        gatewayFinalStatus: RefundStatus.SUCCEEDED,
      });

      const result = await run(ctx);

      const created = (
        ctx.tx.refund.create.mock.calls[0] as [
          { data: Record<string, unknown> },
        ]
      )[0].data;
      expect(created).toMatchObject({
        method: RefundMethod.GATEWAY,
        status: RefundStatus.PENDING,
        completedAt: null,
        provider: 'MERCADO_PAGO',
      });
      expect(ctx.state.refundedAmount.toString()).toBe('3000');
      expect(ctx.cashMovements).toHaveLength(0);
      expect(actions(ctx)).toEqual(['REFUND_REQUESTED']);
      expect(ctx.dispatch).toHaveBeenCalledWith(
        'refund-1',
        expect.objectContaining({ staffUserId: 'staff-1', role: Role.ADMIN }),
      );
      expect(result.refund.status).toBe(RefundStatus.SUCCEEDED);
      expect(result.cashToHandOver).toBeNull();
    });

    it('answers PENDING when the gateway call stays ambiguous and keeps the reservation', async () => {
      const ctx = build({ roles: [Role.ADMIN], payment: gatewayPayment });

      const result = await run(ctx);

      expect(result.refund.status).toBe(RefundStatus.PENDING);
      expect(ctx.state.refundedAmount.toString()).toBe('3000');
    });

    it('answers FAILED with the reason when the gateway rejects it', async () => {
      const ctx = build({
        roles: [Role.ADMIN],
        payment: gatewayPayment,
        gatewayFinalStatus: RefundStatus.FAILED,
      });

      const result = await run(ctx);

      expect(result.refund.status).toBe(RefundStatus.FAILED);
    });

    it('rejects a cashier on a gateway payment with 403 and never reserves anything', async () => {
      const ctx = build({ payment: gatewayPayment });

      const { error, code } = await codeOf(run(ctx));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(code).toBe('REFUND_ADMIN_ONLY');
      expect(ctx.dispatch).not.toHaveBeenCalled();
      expect(ctx.queryRaw).not.toHaveBeenCalled();
    });

    it('registers as manual external without calling the gateway when the admin asks for it', async () => {
      const ctx = build({ roles: [Role.ADMIN], payment: gatewayPayment });

      const result = await run(ctx, dto({ registerAsManual: true }));

      expect(result.refund.method).toBe(RefundMethod.MANUAL_EXTERNAL);
      expect(result.refund.status).toBe(RefundStatus.SUCCEEDED);
      expect(ctx.dispatch).not.toHaveBeenCalled();
      expect(actions(ctx)).toEqual(['REFUND_REGISTERED_MANUAL']);
    });

    it('treats a Transbank payment without gateway meta as manual external', async () => {
      const ctx = build({
        roles: [Role.ADMIN],
        payment: { provider: 'TRANSBANK', providerReference: 'tok' },
      });

      const result = await run(ctx);

      expect(result.refund.method).toBe(RefundMethod.MANUAL_EXTERNAL);
      expect(ctx.dispatch).not.toHaveBeenCalled();
    });

    it('replays the same key without a second reservation or gateway call', async () => {
      const ctx = build({ roles: [Role.ADMIN], payment: gatewayPayment });
      await run(ctx);

      const replay = await run(ctx);

      expect(replay.idempotentReplay).toBe(true);
      expect(ctx.refunds).toHaveLength(1);
      expect(ctx.dispatch).toHaveBeenCalledTimes(1);
      expect(ctx.state.refundedAmount.toString()).toBe('3000');
    });

    it('does not let two concurrent gateway refunds exceed the payment amount', async () => {
      const ctx = build({ roles: [Role.ADMIN], payment: gatewayPayment });

      await run(ctx, dto({ amount: '9000' }), 'key-aaaa-0001');
      const { code } = await codeOf(
        run(ctx, dto({ amount: '3000' }), 'key-aaaa-0002'),
      );

      expect(code).toBe('REFUND_EXCEEDS_REFUNDABLE');
      expect(ctx.dispatch).toHaveBeenCalledTimes(1);
    });
  });
});

describe('RefundPaymentService by item', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const line = (overrides: Record<string, unknown> = {}) => ({
    id: 'line-1',
    description: 'Pizza',
    orderItemId: 'oi-1',
    quantity: 2,
    refundedQuantity: 0,
    totalPrice: d(18000),
    discountAmount: d(1800),
    orderItem: {
      menuItemId: 'menu-1',
      preparationStationId: 'station-1',
      nameSnapshot: 'Pizza',
      categoryPathSnapshot: ['Comida', 'Pizzas'],
    },
    refundItems: [],
    ...overrides,
  });

  const runItems = (
    ctx: ReturnType<typeof build>,
    items: { billItemId: string; quantity: number; kitchenWaste?: boolean }[],
    body: Partial<CreateRefundDto> = {},
    billId = 'bill-1',
  ) =>
    ctx.service.execute(
      authUser,
      'branch-1',
      'payment-1',
      'key-aaaa-0001',
      dto({ amount: '0', ...body }),
      meta,
      { billId, items },
    );

  it('refunds one unit net of the line discount and stores the snapshot', async () => {
    const ctx = build({ billItems: [line()] });
    const result = await runItems(ctx, [
      { billItemId: 'line-1', quantity: 1, kitchenWaste: true },
    ]);

    expect(result.refund.amount).toBe('8100');
    expect(result.refund.items).toEqual([
      {
        billItemId: 'line-1',
        name: 'Pizza',
        quantity: 1,
        amount: '8100',
        kitchenWaste: true,
      },
    ]);
    expect(ctx.state.refundedAmount.toString()).toBe('8100');
    expect(ctx.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(ctx.refunds[0]).toMatchObject({
      items: [
        expect.objectContaining({
          categoryPathSnapshot: ['Comida', 'Pizzas'],
          preparationStationId: 'station-1',
        }),
      ],
    });
  });

  it('closes the last unit with what is left of the line', async () => {
    const ctx = build({
      billItems: [
        line({
          quantity: 3,
          refundedQuantity: 2,
          totalPrice: d(10000),
          discountAmount: d(0),
          refundItems: [{ amount: d(6667) }],
        }),
      ],
    });
    const result = await runItems(ctx, [{ billItemId: 'line-1', quantity: 1 }]);

    expect(result.refund.amount).toBe('3333');
  });

  it('adds a proportional tip when refundTip is set', async () => {
    const ctx = build({
      billItems: [line({ discountAmount: d(0), totalPrice: d(10000) })],
    });
    const result = await runItems(
      ctx,
      [{ billItemId: 'line-1', quantity: 2 }],
      { refundTip: true },
    );

    expect(result.refund.tipAmount).toBe('1000');
    expect(result.refund.amount).toBe('11000');
  });

  it('rejects when the products exceed what the payment can refund', async () => {
    const ctx = build({
      billItems: [
        line({ quantity: 1, totalPrice: d(10500), discountAmount: d(0) }),
      ],
    });
    const { code } = await codeOf(
      runItems(ctx, [{ billItemId: 'line-1', quantity: 1 }]),
    );

    expect(code).toBe('REFUND_ITEMS_EXCEED_PAYMENT');
    expect(ctx.refunds).toHaveLength(0);
  });

  it('rejects more units than the line has left', async () => {
    const ctx = build({ billItems: [line({ refundedQuantity: 1 })] });
    const { code } = await codeOf(
      runItems(ctx, [{ billItemId: 'line-1', quantity: 2 }]),
    );

    expect(code).toBe('REFUND_ITEM_QUANTITY_EXCEEDED');
  });

  it('rejects a line that is not in the bill', async () => {
    const ctx = build({ billItems: [] });
    const { code } = await codeOf(
      runItems(ctx, [{ billItemId: 'line-9', quantity: 1 }]),
    );

    expect(code).toBe('BILL_ITEM_NOT_FOUND');
  });

  it('rejects repeated lines', async () => {
    const ctx = build({ billItems: [line()] });
    const { code } = await codeOf(
      runItems(ctx, [
        { billItemId: 'line-1', quantity: 1 },
        { billItemId: 'line-1', quantity: 1 },
      ]),
    );

    expect(code).toBe('REFUND_ITEMS_DUPLICATED');
  });

  it('fails when another refund took the units first', async () => {
    const ctx = build({ billItems: [line()], itemUpdateResult: 0 });
    const { code } = await codeOf(
      runItems(ctx, [{ billItemId: 'line-1', quantity: 1 }]),
    );

    expect(code).toBe('REFUND_ITEMS_CONFLICT');
  });

  it('locks the bill before touching the lines and guards on the planned discount', async () => {
    const ctx = build({ billItems: [line()] });

    await runItems(ctx, [{ billItemId: 'line-1', quantity: 1 }]);

    const lockCall = ctx.queryRaw.mock.calls.findIndex(([sql]) =>
      sql.sql.includes('FROM bills'),
    );
    const update = ctx.tx.$executeRaw.mock.calls[0] as [Prisma.Sql];

    expect(lockCall).toBeGreaterThanOrEqual(0);
    expect(ctx.queryRaw.mock.invocationCallOrder[lockCall]).toBeLessThan(
      ctx.tx.$executeRaw.mock.invocationCallOrder[0],
    );
    expect(update[0].sql).toContain('discount_amount =');
    expect(update[0].values).toContain('1800.00');
  });

  it('does not accept a payment from another bill', async () => {
    const ctx = build({ billItems: [line()] });
    const { code } = await codeOf(
      runItems(ctx, [{ billItemId: 'line-1', quantity: 1 }], {}, 'bill-2'),
    );

    expect(code).toBe('PAYMENT_NOT_FOUND');
  });

  it('replays the same key without touching the lines again', async () => {
    const ctx = build({ billItems: [line()] });
    const items = [{ billItemId: 'line-1', quantity: 1 }];

    await runItems(ctx, items);
    const replay = await runItems(ctx, items);

    expect(replay.idempotentReplay).toBe(true);
    expect(ctx.refunds).toHaveLength(1);
    expect(ctx.tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('uses a different fingerprint when the items change', async () => {
    const ctx = build({ billItems: [line()] });

    await runItems(ctx, [{ billItemId: 'line-1', quantity: 1 }]);
    const { code } = await codeOf(
      runItems(ctx, [
        { billItemId: 'line-1', quantity: 1, kitchenWaste: true },
      ]),
    );

    expect(code).toBe('REFUND_IDEMPOTENCY_KEY_REUSED');
  });
});
