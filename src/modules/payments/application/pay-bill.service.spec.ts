import { ForbiddenException } from '@nestjs/common';
import { PaymentMethod, Prisma, Role } from '@prisma/client';
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
    ensureAccessMock.mockResolvedValue({
      roles: [Role.WAITER],
      staffUserId: 'staff-1',
    });
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
    ensureAccessMock.mockResolvedValue({
      roles: [Role.CASHIER],
      staffUserId: 'staff-1',
    });

    await service.execute(authUser, 'bill-1', { amount: 1000 } as never);

    expect(settleMock).toHaveBeenCalledTimes(1);
  });

  it('records the cashier as collector and defaults the method to CASH', async () => {
    findUniqueMock.mockResolvedValue(bill(false));
    ensureAccessMock.mockResolvedValue({
      roles: [Role.CASHIER],
      staffUserId: 'staff-7',
    });

    await service.execute(authUser, 'bill-1', { amount: 1000 } as never);

    expect(settleMock.mock.calls[0][5]).toEqual({
      staffUserId: 'staff-7',
      source: 'CASHIER',
      method: PaymentMethod.CASH,
    });
  });

  it('forwards the chosen payment method and marks waiters as WAITER source', async () => {
    findUniqueMock.mockResolvedValue(bill(true));

    await service.execute(authUser, 'bill-1', {
      amount: 1000,
      paymentMethod: PaymentMethod.VOUCHER,
    } as never);

    expect(settleMock.mock.calls[0][5]).toEqual({
      staffUserId: 'staff-1',
      source: 'WAITER',
      method: PaymentMethod.VOUCHER,
    });
  });
});
