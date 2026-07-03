import { BadRequestException } from '@nestjs/common';
import {
  BillStatus,
  Prisma,
  Role,
  TableSessionOpenedBySource,
  TableSessionStatus,
  TableStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { CloseTableSessionService } from './close-table-session.service';
import { FloorBranchAccessService } from './floor-branch-access.service';

type TransactionClient = {
  bill: {
    create: jest.Mock<
      Promise<{
        id: string;
        remainingAmount: Prisma.Decimal;
      }>,
      [unknown]
    >;
    update: jest.Mock<Promise<unknown>, [unknown]>;
  };
  tableSession: {
    update: jest.Mock<
      Promise<{
        id: string;
        tableId: string;
        branchId: string;
        status: TableSessionStatus;
        openedBySource: TableSessionOpenedBySource;
        openedAt: Date;
        closeReason: string | null;
        closedAt: Date | null;
      }>,
      [unknown]
    >;
  };
  table: {
    update: jest.Mock<Promise<unknown>, [unknown]>;
  };
};

type BillRecord = {
  id: string;
  remainingAmount: Prisma.Decimal;
};

type TableSessionRecord = {
  id: string;
  tableId: string;
  branchId: string;
  status: TableSessionStatus;
  openedBySource: TableSessionOpenedBySource;
  openedAt: Date;
  closeReason: string | null;
  closedAt: Date | null;
};

describe('CloseTableSessionService', () => {
  const findUniqueMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    tableSession: {
      findUnique: findUniqueMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const floorBranchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as FloorBranchAccessService;

  let service: CloseTableSessionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CloseTableSessionService(prisma, floorBranchAccessService);
  });

  it('closes an active table session and frees the table', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'session-1',
      tableId: 'table-1',
      branchId: 'branch-1',
      status: TableSessionStatus.OPEN,
      openedBySource: TableSessionOpenedBySource.WAITER,
      openedAt: new Date('2026-07-03T12:00:00.000Z'),
      closeReason: null,
      closedAt: null,
      bill: {
        id: 'bill-1',
        remainingAmount: new Prisma.Decimal('0'),
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.WAITER],
    });

    const createBillMock = jest.fn<Promise<BillRecord>, [unknown]>();
    const updateBillMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});
    const updateSessionMock = jest
      .fn<
        Promise<{
          id: string;
          tableId: string;
          branchId: string;
          status: TableSessionStatus;
          openedBySource: TableSessionOpenedBySource;
          openedAt: Date;
          closeReason: string | null;
          closedAt: Date | null;
        }>,
        [unknown]
      >()
      .mockResolvedValue({
        id: 'session-1',
        tableId: 'table-1',
        branchId: 'branch-1',
        status: TableSessionStatus.CLOSED,
        openedBySource: TableSessionOpenedBySource.WAITER,
        openedAt: new Date('2026-07-03T12:00:00.000Z'),
        closeReason: 'Caja cerrada',
        closedAt: new Date('2026-07-03T13:00:00.000Z'),
      });
    const updateTableMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});

    transactionMock.mockImplementation(
      (callback: (transactionClient: TransactionClient) => Promise<unknown>) =>
        callback({
          bill: {
            create: createBillMock,
            update: updateBillMock,
          },
          tableSession: {
            update: updateSessionMock,
          },
          table: {
            update: updateTableMock,
          },
        }),
    );

    const result = await service.execute(
      {
        sub: 'auth-1',
        profileType: 'staff',
        profileId: 'staff-1',
        restaurantId: 'restaurant-1',
      },
      'session-1',
      {
        closeReason: 'Caja cerrada',
      },
    );

    expect(createBillMock).not.toHaveBeenCalled();
    const updateBillArgs = updateBillMock.mock.calls[0]?.[0] as {
      data: {
        status: BillStatus;
        resolvedByStaffUserId: string;
        closeReason: string | null;
      };
    };
    const updateTableArgs = updateTableMock.mock.calls[0]?.[0] as {
      data: {
        status: TableStatus;
      };
    };

    expect(updateBillArgs.data.status).toBe(BillStatus.PAID);
    expect(updateBillArgs.data.resolvedByStaffUserId).toBe('staff-1');
    expect(updateBillArgs.data.closeReason).toBe('Caja cerrada');
    expect(updateTableArgs.data.status).toBe(TableStatus.AVAILABLE);
    expect(result.status).toBe(TableSessionStatus.CLOSED);
  });

  it('creates the missing bill for a legacy active session before closing it', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'session-legacy',
      tableId: 'table-1',
      branchId: 'branch-1',
      status: TableSessionStatus.OPEN,
      openedBySource: TableSessionOpenedBySource.CASHIER,
      openedAt: new Date('2026-07-03T12:00:00.000Z'),
      closeReason: null,
      closedAt: null,
      bill: null,
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-2',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.CASHIER],
    });

    const createBillMock = jest
      .fn<Promise<BillRecord>, [unknown]>()
      .mockResolvedValue({
        id: 'bill-created',
        remainingAmount: new Prisma.Decimal('0'),
      });
    const updateBillMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});
    const updateSessionMock = jest
      .fn<
        Promise<{
          id: string;
          tableId: string;
          branchId: string;
          status: TableSessionStatus;
          openedBySource: TableSessionOpenedBySource;
          openedAt: Date;
          closeReason: string | null;
          closedAt: Date | null;
        }>,
        [unknown]
      >()
      .mockResolvedValue({
        id: 'session-legacy',
        tableId: 'table-1',
        branchId: 'branch-1',
        status: TableSessionStatus.CLOSED,
        openedBySource: TableSessionOpenedBySource.CASHIER,
        openedAt: new Date('2026-07-03T12:00:00.000Z'),
        closeReason: null,
        closedAt: new Date('2026-07-03T13:00:00.000Z'),
      });
    const updateTableMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});

    transactionMock.mockImplementation(
      (callback: (transactionClient: TransactionClient) => Promise<unknown>) =>
        callback({
          bill: {
            create: createBillMock,
            update: updateBillMock,
          },
          tableSession: {
            update: updateSessionMock,
          },
          table: {
            update: updateTableMock,
          },
        }),
    );

    await service.execute(
      {
        sub: 'auth-2',
        profileType: 'staff',
        profileId: 'staff-2',
        restaurantId: 'restaurant-1',
      },
      'session-legacy',
      {},
    );

    const createBillArgs = createBillMock.mock.calls[0]?.[0] as {
      data: {
        tableSessionId: string;
        branchId: string;
        status: BillStatus;
      };
    };

    expect(createBillArgs.data.tableSessionId).toBe('session-legacy');
    expect(createBillArgs.data.branchId).toBe('branch-1');
    expect(createBillArgs.data.status).toBe(BillStatus.OPEN);
  });

  it('rejects closing a session with pending balance', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'session-1',
      tableId: 'table-1',
      branchId: 'branch-1',
      status: TableSessionStatus.OPEN,
      openedBySource: TableSessionOpenedBySource.WAITER,
      openedAt: new Date('2026-07-03T12:00:00.000Z'),
      closeReason: null,
      closedAt: null,
      bill: {
        id: 'bill-1',
        remainingAmount: new Prisma.Decimal('15000'),
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.WAITER],
    });

    const createBillMock = jest.fn<Promise<BillRecord>, [unknown]>();
    const updateBillMock = jest.fn<Promise<unknown>, [unknown]>();
    const updateSessionMock = jest.fn<Promise<TableSessionRecord>, [unknown]>();
    const updateTableMock = jest.fn<Promise<unknown>, [unknown]>();

    transactionMock.mockImplementation(
      (callback: (transactionClient: TransactionClient) => Promise<unknown>) =>
        callback({
          bill: {
            create: createBillMock,
            update: updateBillMock,
          },
          tableSession: {
            update: updateSessionMock,
          },
          table: {
            update: updateTableMock,
          },
        }),
    );

    await expect(
      service.execute(
        {
          sub: 'auth-1',
          profileType: 'staff',
          profileId: 'staff-1',
          restaurantId: 'restaurant-1',
        },
        'session-1',
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(updateSessionMock).not.toHaveBeenCalled();
    expect(updateBillMock).not.toHaveBeenCalled();
  });
});
