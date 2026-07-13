import { TableSessionStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { AbandonTableSessionService } from './abandon-table-session.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';

describe('AbandonTableSessionService', () => {
  const tableSessionFindUniqueMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    tableSession: {
      findUnique: tableSessionFindUniqueMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const BranchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  let service: AbandonTableSessionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AbandonTableSessionService(prisma, BranchAccessService);
  });

  it('marks the session and bill as abandoned and frees the table', async () => {
    tableSessionFindUniqueMock.mockResolvedValue({
      id: 'session-1',
      tableId: 'table-1',
      branchId: 'branch-1',
      status: TableSessionStatus.OPEN,
      openedBySource: 'WAITER',
      openedAt: new Date('2026-07-07T12:00:00.000Z'),
      bill: {
        id: 'bill-1',
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      roles: ['CASHIER'],
    });

    const sessionUpdateMock = jest.fn().mockResolvedValue({
      id: 'session-1',
      tableId: 'table-1',
      branchId: 'branch-1',
      status: TableSessionStatus.ABANDONED,
      openedBySource: 'WAITER',
      openedAt: new Date('2026-07-07T12:00:00.000Z'),
      closeReason: 'Clientes se fueron sin pagar.',
      closedAt: new Date('2026-07-07T13:00:00.000Z'),
    });
    const billUpdateMock = jest.fn().mockResolvedValue({});
    const tableUpdateMock = jest.fn().mockResolvedValue({});

    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          tableSession: { update: sessionUpdateMock },
          bill: { update: billUpdateMock },
          table: { update: tableUpdateMock },
        }),
    );

    const result = await service.execute(authUser, 'session-1', {
      closeReason: 'Clientes se fueron sin pagar.',
    });

    expect(result.status).toBe(TableSessionStatus.ABANDONED);
    expect(billUpdateMock).toHaveBeenCalled();
    expect(tableUpdateMock).toHaveBeenCalled();
  });
});
