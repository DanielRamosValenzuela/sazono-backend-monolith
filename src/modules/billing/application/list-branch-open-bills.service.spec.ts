import { Prisma, Role, TableSessionStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { ListBranchOpenBillsService } from './list-branch-open-bills.service';

describe('ListBranchOpenBillsService', () => {
  const findManyMock = jest.fn();
  const prisma = {
    tableSession: {
      findMany: findManyMock,
    },
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const BranchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  let service: ListBranchOpenBillsService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ListBranchOpenBillsService(
      prisma,
      BranchAccessService,
    );
  });

  it('returns one row per active session that already has a bill', async () => {
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.CASHIER],
    });
    findManyMock.mockResolvedValue([
      {
        id: 'session-1',
        status: TableSessionStatus.OPEN,
        openedAt: new Date('2026-07-08T12:00:00.000Z'),
        table: { id: 'table-1', code: 'M01', name: 'Mesa 1' },
        bill: {
          id: 'bill-1',
          totalAmount: new Prisma.Decimal('11800'),
          remainingAmount: new Prisma.Decimal('11800'),
        },
      },
      {
        id: 'session-2',
        status: TableSessionStatus.PAYMENT_COMPLETED,
        openedAt: new Date('2026-07-08T12:10:00.000Z'),
        table: { id: 'table-2', code: 'M02', name: 'Mesa 2' },
        bill: null,
      },
    ]);

    const result = await service.execute(authUser, 'branch-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      tableId: 'table-1',
      tableCode: 'M01',
      billId: 'bill-1',
      totalAmount: '11800',
      remainingAmount: '11800',
    });
    expect(ensureAccessMock).toHaveBeenCalledWith(
      authUser,
      'branch-1',
      expect.arrayContaining([Role.ADMIN, Role.SUPERVISOR, Role.CASHIER]),
    );
  });

  it('returns an empty list when there are no active sessions', async () => {
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.ADMIN],
    });
    findManyMock.mockResolvedValue([]);

    const result = await service.execute(authUser, 'branch-1');

    expect(result).toEqual([]);
  });
});
