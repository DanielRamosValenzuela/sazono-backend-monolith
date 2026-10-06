import { OrderStatus, Role } from '@prisma/client';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { ListBranchReadySummaryService } from './list-branch-ready-summary.service';

describe('ListBranchReadySummaryService', () => {
  const settingsMock = jest.fn();
  const orderFindManyMock = jest.fn();
  const txOrderFindManyMock = jest.fn();
  const orderUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
  const itemUpdateManyMock = jest.fn().mockResolvedValue({ count: 1 });
  const transactionMock = jest.fn();
  const service = new ListBranchReadySummaryService(
    {
      branchSettings: { findUnique: settingsMock },
      order: { findMany: orderFindManyMock, updateMany: orderUpdateManyMock },
      orderItem: { updateMany: itemUpdateManyMock },
      $transaction: transactionMock,
    } as unknown as PrismaService,
    {
      ensureAccess: jest.fn().mockResolvedValue({ roles: [Role.WAITER] }),
    } as unknown as BranchAccessService,
  );
  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };
  const longAgo = new Date(Date.now() - 3_600_000);
  const readyOrder = (
    id: string,
    sessionId: string,
    session: Record<string, unknown>,
  ) => ({
    id,
    tableSessionId: sessionId,
    tableSession: {
      tableId: 'table-1',
      openedByStaffUserId: 'staff-1',
      assignedStaffUserId: null,
      isCounter: false,
      ticketNumber: null,
      customerLabel: null,
      table: { code: 'M01' },
      ...session,
    },
    stationTickets: [{ completedAt: longAgo }],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          order: {
            findMany: txOrderFindManyMock,
            updateMany: orderUpdateManyMock,
          },
          orderItem: { updateMany: itemUpdateManyMock },
        }),
    );
    txOrderFindManyMock.mockResolvedValue([{ id: 'o-table' }]);
    settingsMock.mockResolvedValue({
      autoDeliverAfterMinutes: 5,
      tableAssignmentEnabled: false,
    });
  });

  it('auto-delivers table orders only while still READY and never counter orders', async () => {
    orderFindManyMock.mockResolvedValue([
      readyOrder('o-table', 's-table', {}),
      readyOrder('o-counter-1', 's-counter', {
        isCounter: true,
        ticketNumber: 12,
        customerLabel: 'Ana',
        table: { code: 'MOSTRADOR' },
      }),
      readyOrder('o-counter-2', 's-counter', {
        isCounter: true,
        ticketNumber: 12,
        customerLabel: 'Ana',
        table: { code: 'MOSTRADOR' },
      }),
    ]);

    const result = await service.execute(authUser, { branchId: 'branch-1' });

    expect(orderUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ['o-table'] }, status: OrderStatus.READY },
      data: { status: OrderStatus.DELIVERED },
    });
    expect(itemUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orderId: { in: ['o-table'] } }),
      }),
    );
    expect(result).toEqual([
      {
        tableSessionId: 's-counter',
        tableId: 'table-1',
        tableCode: 'MOSTRADOR',
        isCounter: true,
        ticketNumber: 12,
        customerLabel: 'Ana',
        openedByStaffUserId: 'staff-1',
        assignedStaffUserId: null,
        readyUndeliveredCount: 2,
      },
    ]);
  });
});
