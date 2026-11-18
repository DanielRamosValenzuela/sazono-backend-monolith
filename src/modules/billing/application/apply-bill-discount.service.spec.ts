import { ConflictException } from '@nestjs/common';
import {
  BillStatus,
  DiscountReason,
  DiscountType,
  Prisma,
  Role,
} from '@prisma/client';
import type { ApprovalPinService } from '../../../common/approval/approval-pin.service';
import type { AuditService } from '../../../common/audit/audit.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type { CreateBillDiscountDto } from '../presentation/http/dto/discounts.dto';
import { ApplyBillDiscountService } from './apply-bill-discount.service';

const mockRefresh = jest.fn();

jest.mock('./lock-bill', () => ({
  lockBill: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./refresh-bill-discounts', () => ({
  refreshBillDiscounts: (...args: unknown[]) => mockRefresh(...args) as unknown,
}));

const d = (value: number) => new Prisma.Decimal(value);
const BRANCH = '11111111-1111-4111-8111-111111111111';
const BILL = '22222222-2222-4222-8222-222222222222';
const META = { ip: null, userAgent: null };
const AUTH = { sub: 'user-1' } as unknown as JwtPayload;

function bill(overrides: Record<string, unknown> = {}) {
  return {
    id: BILL,
    tableSessionId: 'session-1',
    branchId: BRANCH,
    status: BillStatus.OPEN,
    subtotalAmount: d(10000),
    discountAmount: d(0),
    tipAmount: d(0),
    totalAmount: d(10000),
    remainingAmount: d(10000),
    refundedAmount: d(0),
    ...overrides,
  };
}

function dto(
  overrides: Partial<CreateBillDiscountDto> = {},
): CreateBillDiscountDto {
  return {
    type: DiscountType.PERCENT,
    value: '5',
    reasonCode: DiscountReason.COURTESY,
    reasonText: 'Cortesia de la casa',
    ...overrides,
  };
}

function build(options: {
  roles?: Role[];
  bill?: Record<string, unknown>;
  pendingAttempts?: number;
  existing?: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
}) {
  const billUpdate = jest.fn().mockImplementation(({ data }) =>
    Promise.resolve({
      ...bill(options.bill),
      ...data,
    }),
  );
  const discountCreate = jest.fn().mockResolvedValue({ id: 'discount-1' });
  const record = {
    id: 'discount-1',
    billId: BILL,
    billItemId: null,
    billItem: null,
    type: 'PERCENT',
    value: d(5),
    amount: d(500),
    reasonCode: 'COURTESY',
    reasonText: 'Cortesia de la casa',
    appliedByStaffUserId: 'staff-1',
    appliedBy: { firstName: 'Ana', lastName: 'Perez' },
    appliedByRole: Role.CASHIER,
    approvedByStaffUserId: null,
    approvedBy: null,
    voidedAt: null,
    voidedByStaffUserId: null,
    voidedBy: null,
    voidReason: null,
    createdAt: new Date('2026-11-18T12:00:00Z'),
  };
  const tx = {
    bill: {
      findFirst: jest.fn().mockResolvedValue(bill(options.bill)),
      update: billUpdate,
    },
    billItem: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'item-1', totalPrice: d(10000) }]),
    },
    billDiscount: {
      findMany: jest.fn().mockResolvedValue([]),
      create: discountCreate,
      findUniqueOrThrow: jest.fn().mockResolvedValue(record),
    },
    branchSettings: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options.settings === undefined
            ? { discountApprovalPercent: d(10), discountApprovalAmount: null }
            : options.settings,
        ),
    },
    paymentAttempt: {
      count: jest.fn().mockResolvedValue(options.pendingAttempts ?? 0),
    },
    billSplit: { findFirst: jest.fn().mockResolvedValue(null) },
    orderItem: { updateMany: jest.fn() },
    order: { updateMany: jest.fn() },
    tableSession: { updateMany: jest.fn() },
  };
  const prisma = {
    ...tx,
    billDiscount: {
      ...tx.billDiscount,
      findUnique: jest.fn().mockResolvedValue(options.existing ?? null),
    },
    bill: {
      ...tx.bill,
      findUniqueOrThrow: jest.fn().mockResolvedValue(bill()),
    },
    $transaction: jest.fn((callback: (client: unknown) => unknown) =>
      callback(tx),
    ),
  };
  const branchAccess = {
    ensureAccess: jest.fn().mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      roles: options.roles ?? [Role.CASHIER],
    }),
  };
  const approval = {
    listApprovers: jest
      .fn()
      .mockResolvedValue([{ staffUserId: 'admin-1', name: 'Admin' }]),
    verify: jest.fn().mockResolvedValue('admin-1'),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ApplyBillDiscountService(
    prisma as unknown as PrismaService,
    branchAccess as unknown as BranchAccessService,
    approval as unknown as ApprovalPinService,
    audit as unknown as AuditService,
  );

  return { service, tx, prisma, approval, audit, billUpdate, discountCreate };
}

describe('ApplyBillDiscountService', () => {
  beforeEach(() => {
    mockRefresh.mockReset().mockResolvedValue(d(500));
  });

  it('applies a discount under the threshold and rewrites the bill totals', async () => {
    const { service, billUpdate, discountCreate, audit } = build({});

    const result = await service.execute(
      AUTH,
      BRANCH,
      BILL,
      'key-123456789',
      dto(),
      META,
    );

    expect(discountCreate).toHaveBeenCalledTimes(1);
    expect(billUpdate).toHaveBeenCalledWith({
      where: { id: BILL },
      data: expect.objectContaining({
        discountAmount: d(500),
        totalAmount: d(9500),
        remainingAmount: d(9500),
        status: BillStatus.OPEN,
      }),
    });
    expect(result.bill.consumptionAmount).toBe('9500');
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'DISCOUNT_APPLIED' }),
    );
  });

  it('asks for an admin PIN when a non admin goes over the percent threshold', async () => {
    const { service, discountCreate } = build({});

    await expect(
      service.execute(
        AUTH,
        BRANCH,
        BILL,
        'key-123456789',
        dto({ value: '20' }),
        META,
      ),
    ).rejects.toMatchObject({
      response: { code: 'DISCOUNT_NEEDS_APPROVAL' },
    });
    expect(discountCreate).not.toHaveBeenCalled();
  });

  it('verifies the PIN and stores the approver', async () => {
    const { service, approval, discountCreate } = build({});

    await service.execute(
      AUTH,
      BRANCH,
      BILL,
      'key-123456789',
      dto({
        value: '20',
        approverStaffUserId: '33333333-3333-4333-8333-333333333333',
        approverPin: '4321',
      }),
      META,
    );

    expect(approval.verify).toHaveBeenCalledTimes(1);
    expect(discountCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ approvedByStaffUserId: 'admin-1' }),
    });
  });

  it('lets an admin apply a courtesy without a PIN', async () => {
    const { service, approval } = build({ roles: [Role.ADMIN] });

    await service.execute(
      AUTH,
      BRANCH,
      BILL,
      'key-123456789',
      dto({ value: '100' }),
      META,
    );

    expect(approval.verify).not.toHaveBeenCalled();
  });

  it('rejects bills that are already paid', async () => {
    const { service } = build({ bill: { status: BillStatus.PAID } });

    await expect(
      service.execute(AUTH, BRANCH, BILL, 'key-123456789', dto(), META),
    ).rejects.toMatchObject({
      response: { code: 'DISCOUNT_BILL_NOT_PAYABLE' },
    });
  });

  it('rejects bills that already have refunds', async () => {
    const { service } = build({ bill: { refundedAmount: d(1000) } });

    await expect(
      service.execute(AUTH, BRANCH, BILL, 'key-123456789', dto(), META),
    ).rejects.toMatchObject({
      response: { code: 'DISCOUNT_BILL_HAS_REFUNDS' },
    });
  });

  it('rejects while a payment attempt is pending', async () => {
    const { service } = build({ pendingAttempts: 1 });

    await expect(
      service.execute(AUTH, BRANCH, BILL, 'key-123456789', dto(), META),
    ).rejects.toMatchObject({
      response: { code: 'DISCOUNT_PAYMENT_IN_PROGRESS' },
    });
  });

  it('caps the discount at subtotal plus tip minus what was paid', async () => {
    const { service } = build({
      roles: [Role.ADMIN],
      bill: { totalAmount: d(10000), remainingAmount: d(2000) },
    });

    await expect(
      service.execute(
        AUTH,
        BRANCH,
        BILL,
        'key-123456789',
        dto({ type: DiscountType.AMOUNT, value: '3000' }),
        META,
      ),
    ).rejects.toMatchObject({
      response: { code: 'DISCOUNT_EXCEEDS_REMAINING', maxDiscount: '2000' },
    });
  });

  it('rejects a line AMOUNT discount larger than the line total', async () => {
    const { service, discountCreate } = build({ roles: [Role.ADMIN] });

    await expect(
      service.execute(
        AUTH,
        BRANCH,
        BILL,
        'key-123456789',
        dto({
          type: DiscountType.AMOUNT,
          value: '10001',
          billItemId: 'item-1',
        }),
        META,
      ),
    ).rejects.toMatchObject({
      response: { code: 'DISCOUNT_VALUE_INVALID' },
    });
    expect(discountCreate).not.toHaveBeenCalled();
  });

  it('replays an existing request with the same fingerprint', async () => {
    const first = build({});
    await first.service.execute(
      AUTH,
      BRANCH,
      BILL,
      'key-123456789',
      dto(),
      META,
    );
    const stored = await first.tx.billDiscount.findUniqueOrThrow();
    const fingerprintCall = first.discountCreate.mock.calls[0][0] as {
      data: { requestFingerprint: string };
    };
    const { service, discountCreate } = build({
      existing: {
        ...stored,
        requestFingerprint: fingerprintCall.data.requestFingerprint,
      },
    });

    const result = await service.execute(
      AUTH,
      BRANCH,
      BILL,
      'key-123456789',
      dto(),
      META,
    );

    expect(result.idempotentReplay).toBe(true);
    expect(discountCreate).not.toHaveBeenCalled();
  });

  it('refuses to reuse an idempotency key for another request', async () => {
    const { service } = build({
      existing: {
        id: 'discount-1',
        billId: BILL,
        appliedByStaffUserId: 'staff-1',
        requestFingerprint: 'other',
      },
    });

    await expect(
      service.execute(AUTH, BRANCH, BILL, 'key-123456789', dto(), META),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
