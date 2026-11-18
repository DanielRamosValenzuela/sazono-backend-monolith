import { BillStatus, Prisma, Role } from '@prisma/client';
import type { AuditService } from '../../../common/audit/audit.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { VoidBillDiscountService } from './void-bill-discount.service';

const mockRefresh = jest.fn();

jest.mock('./lock-bill', () => ({
  lockBill: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./refresh-bill-discounts', () => ({
  refreshBillDiscounts: (...args: unknown[]) => mockRefresh(...args) as unknown,
}));

const d = (value: number) => new Prisma.Decimal(value);
const META = { ip: null, userAgent: null };
const AUTH = { sub: 'user-1' } as unknown as JwtPayload;

function build(options: {
  roles: Role[];
  appliedBy?: string;
  approvedBy?: string | null;
  voidedAt?: Date | null;
}) {
  const discount = {
    id: 'discount-1',
    billId: 'bill-1',
    amount: d(1000),
    appliedByStaffUserId: options.appliedBy ?? 'staff-1',
    approvedByStaffUserId: options.approvedBy ?? null,
    voidedAt: options.voidedAt ?? null,
  };
  const currentBill = {
    id: 'bill-1',
    tableSessionId: 'session-1',
    branchId: 'branch-1',
    status: BillStatus.OPEN,
    subtotalAmount: d(10000),
    discountAmount: d(1000),
    tipAmount: d(0),
    totalAmount: d(9000),
    remainingAmount: d(9000),
    refundedAmount: d(0),
  };
  const billUpdate = jest
    .fn()
    .mockImplementation(({ data }) =>
      Promise.resolve({ ...currentBill, ...data }),
    );
  const tx = {
    billDiscount: {
      findFirst: jest.fn().mockResolvedValue(discount),
      update: jest.fn().mockResolvedValue({}),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        ...discount,
        billItem: null,
        appliedBy: { firstName: 'A', lastName: 'B' },
        approvedBy: null,
        voidedBy: null,
        type: 'PERCENT',
        value: d(10),
        reasonCode: 'COURTESY',
        reasonText: 'x',
        appliedByRole: Role.CASHIER,
        voidReason: 'Error de digitacion',
        voidedByStaffUserId: 'staff-1',
        billItemId: null,
        createdAt: new Date(),
      }),
    },
    bill: {
      findFirst: jest.fn().mockResolvedValue(currentBill),
      update: billUpdate,
    },
    billSplit: { findFirst: jest.fn().mockResolvedValue(null) },
    paymentAttempt: { count: jest.fn().mockResolvedValue(0) },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: unknown) => unknown) =>
      callback(tx),
    ),
  };
  const branchAccess = {
    ensureAccess: jest.fn().mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      roles: options.roles,
    }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new VoidBillDiscountService(
    prisma as unknown as PrismaService,
    branchAccess as unknown as BranchAccessService,
    audit as unknown as AuditService,
  );

  return { service, billUpdate, tx, audit };
}

describe('VoidBillDiscountService', () => {
  beforeEach(() => {
    mockRefresh.mockReset().mockResolvedValue(d(0));
  });

  it('voids a discount and restores the full total', async () => {
    const { service, billUpdate, audit } = build({ roles: [Role.SUPERVISOR] });

    const result = await service.execute(
      AUTH,
      'branch-1',
      'bill-1',
      'discount-1',
      { reasonText: 'Error de digitacion' },
      META,
    );

    expect(billUpdate).toHaveBeenCalledWith({
      where: { id: 'bill-1' },
      data: expect.objectContaining({
        discountAmount: d(0),
        totalAmount: d(10000),
        remainingAmount: d(10000),
      }),
    });
    expect(result.bill.remainingAmount).toBe('10000');
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'DISCOUNT_VOIDED' }),
    );
  });

  it('refuses to void while a payment is in progress', async () => {
    const { service, tx, billUpdate } = build({ roles: [Role.SUPERVISOR] });

    tx.paymentAttempt.count.mockResolvedValue(1);

    await expect(
      service.execute(
        AUTH,
        'branch-1',
        'bill-1',
        'discount-1',
        { reasonText: 'Error de digitacion' },
        META,
      ),
    ).rejects.toMatchObject({
      response: { code: 'DISCOUNT_PAYMENT_IN_PROGRESS' },
    });
    expect(billUpdate).not.toHaveBeenCalled();
  });

  it('lets a cashier void only their own discount without approval', async () => {
    const own = build({ roles: [Role.CASHIER] });

    await expect(
      own.service.execute(
        AUTH,
        'branch-1',
        'bill-1',
        'discount-1',
        { reasonText: 'Error de digitacion' },
        META,
      ),
    ).resolves.toBeDefined();

    const other = build({ roles: [Role.CASHIER], appliedBy: 'staff-2' });

    await expect(
      other.service.execute(
        AUTH,
        'branch-1',
        'bill-1',
        'discount-1',
        { reasonText: 'Error de digitacion' },
        META,
      ),
    ).rejects.toMatchObject({ response: { code: 'DISCOUNT_VOID_FORBIDDEN' } });

    const approved = build({ roles: [Role.CASHIER], approvedBy: 'admin-1' });

    await expect(
      approved.service.execute(
        AUTH,
        'branch-1',
        'bill-1',
        'discount-1',
        { reasonText: 'Error de digitacion' },
        META,
      ),
    ).rejects.toMatchObject({ response: { code: 'DISCOUNT_VOID_FORBIDDEN' } });
  });

  it('rejects voiding twice', async () => {
    const { service } = build({
      roles: [Role.ADMIN],
      voidedAt: new Date(),
    });

    await expect(
      service.execute(
        AUTH,
        'branch-1',
        'bill-1',
        'discount-1',
        { reasonText: 'Error de digitacion' },
        META,
      ),
    ).rejects.toMatchObject({ response: { code: 'DISCOUNT_ALREADY_VOIDED' } });
  });
});
