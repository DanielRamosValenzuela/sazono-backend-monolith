import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  BillStatus,
  Role,
  TableSessionOpenedBySource,
  TableSessionStatus,
  TableStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { OpenTableSessionService } from './open-table-session.service';
import type { FloorBranchAccessService } from './floor-branch-access.service';
import { LoginProfileType } from '../../auth/dto/login.dto';

type TransactionClient = {
  bill: {
    create: jest.Mock<Promise<unknown>, [unknown]>;
  };
  tableSession: {
    findFirst: jest.Mock<Promise<null | { id: string }>, [unknown]>;
    create: jest.Mock<
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

describe('OpenTableSessionService', () => {
  const findUniqueMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    table: {
      findUnique: findUniqueMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const floorBranchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as FloorBranchAccessService;

  let service: OpenTableSessionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OpenTableSessionService(prisma, floorBranchAccessService);
  });

  it('opens a new active session and marks the table occupied', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'table-1',
      branchId: 'branch-1',
      status: TableStatus.AVAILABLE,
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.WAITER],
    });

    const findFirstSessionMock = jest
      .fn<Promise<null | { id: string }>, [unknown]>()
      .mockResolvedValue(null);
    const createSessionMock = jest
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
        status: TableSessionStatus.OPEN,
        openedBySource: TableSessionOpenedBySource.WAITER,
        openedAt: new Date('2026-07-03T12:00:00.000Z'),
        closeReason: null,
        closedAt: null,
      });
    const createBillMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});
    const updateTableMock = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});

    transactionMock.mockImplementation(
      (callback: (transactionClient: TransactionClient) => Promise<unknown>) =>
        callback({
          bill: {
            create: createBillMock,
          },
          tableSession: {
            findFirst: findFirstSessionMock,
            create: createSessionMock,
          },
          table: {
            update: updateTableMock,
          },
        }),
    );

    const result = await service.execute(
      {
        sub: 'auth-1',
        profileType: LoginProfileType.STAFF,
        profileId: 'staff-1',
        restaurantId: 'restaurant-1',
      },
      {
        tableId: 'table-1',
        openedBySource: TableSessionOpenedBySource.WAITER,
      },
    );

    expect(result.tableSessionId).toBe('session-1');
    expect(result.status).toBe(TableSessionStatus.OPEN);
    const createBillArgs = createBillMock.mock.calls[0]?.[0] as {
      data: {
        tableSessionId: string;
        branchId: string;
        status: BillStatus;
      };
    };

    expect(createBillArgs.data.tableSessionId).toBe('session-1');
    expect(createBillArgs.data.branchId).toBe('branch-1');
    expect(createBillArgs.data.status).toBe(BillStatus.OPEN);
  });

  it('rejects opening a session on a disabled table', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'table-1',
      branchId: 'branch-1',
      status: TableStatus.DISABLED,
    });

    await expect(
      service.execute(
        {
          sub: 'auth-1',
          profileType: LoginProfileType.STAFF,
          profileId: 'staff-1',
          restaurantId: 'restaurant-1',
        },
        {
          tableId: 'table-1',
          openedBySource: TableSessionOpenedBySource.WAITER,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a second active session on the same table', async () => {
    findUniqueMock.mockResolvedValue({
      id: 'table-1',
      branchId: 'branch-1',
      status: TableStatus.AVAILABLE,
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.WAITER],
    });

    const findFirstSessionMock = jest
      .fn<Promise<null | { id: string }>, [unknown]>()
      .mockResolvedValue({
        id: 'session-existing',
      });
    const createSessionMock = jest.fn<
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
    >();
    const createBillMock = jest.fn<Promise<unknown>, [unknown]>();
    const updateTableMock = jest.fn<Promise<unknown>, [unknown]>();

    transactionMock.mockImplementation(
      (callback: (transactionClient: TransactionClient) => Promise<unknown>) =>
        callback({
          bill: {
            create: createBillMock,
          },
          tableSession: {
            findFirst: findFirstSessionMock,
            create: createSessionMock,
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
          profileType: LoginProfileType.STAFF,
          profileId: 'staff-1',
          restaurantId: 'restaurant-1',
        },
        {
          tableId: 'table-1',
          openedBySource: TableSessionOpenedBySource.WAITER,
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
