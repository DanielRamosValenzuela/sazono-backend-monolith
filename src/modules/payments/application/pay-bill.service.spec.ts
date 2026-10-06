import { ForbiddenException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { PayBillService } from './pay-bill.service';
import type { SettleBillPaymentService } from './settle-bill-payment.service';

describe('PayBillService', () => {
  const findUniqueMock = jest.fn();
  const ensureAccessMock = jest.fn();
  const settleMock = jest.fn().mockResolvedValue({ ok: true });
  const service = new PayBillService(
    { bill: { findUnique: findUniqueMock } } as unknown as PrismaService,
    { ensureAccess: ensureAccessMock } as unknown as BranchAccessService,
    { execute: settleMock } as unknown as SettleBillPaymentService,
  );
  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };
  const bill = (isCounter: boolean) => ({
    id: 'bill-1',
    status: 'OPEN',
    branchId: 'branch-1',
    remainingAmount: new Prisma.Decimal('1000'),
    branch: { restaurantId: 'restaurant-1', restaurant: { currency: 'CLP' } },
    tableSession: { isCounter },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ensureAccessMock.mockResolvedValue({ roles: [Role.WAITER] });
  });

  it('lets a waiter pay a counter bill', async () => {
    findUniqueMock.mockResolvedValue(bill(true));

    await service.execute(authUser, 'bill-1', { amount: 1000 } as never);

    expect(settleMock).toHaveBeenCalledTimes(1);
  });

  it('forbids a waiter from paying a table bill', async () => {
    findUniqueMock.mockResolvedValue(bill(false));

    await expect(
      service.execute(authUser, 'bill-1', { amount: 1000 } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(settleMock).not.toHaveBeenCalled();
  });

  it('lets a cashier pay a table bill', async () => {
    findUniqueMock.mockResolvedValue(bill(false));
    ensureAccessMock.mockResolvedValue({ roles: [Role.CASHIER] });

    await service.execute(authUser, 'bill-1', { amount: 1000 } as never);

    expect(settleMock).toHaveBeenCalledTimes(1);
  });
});
