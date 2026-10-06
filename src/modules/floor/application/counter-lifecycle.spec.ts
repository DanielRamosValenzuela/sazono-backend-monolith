import { ConflictException, ForbiddenException } from '@nestjs/common';
import { BillStatus, Prisma, Role, TableSessionStatus } from '@prisma/client';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { AbandonStaleCounterSessionsService } from './abandon-stale-counter-sessions.service';
import { AbandonTableSessionService } from './abandon-table-session.service';
import { CloseTableSessionService } from './close-table-session.service';

const authUser = {
  sub: 'auth-1',
  profileType: LoginProfileType.STAFF,
  profileId: 'staff-1',
  restaurantId: 'restaurant-1',
};

const baseSession = {
  id: 'session-1',
  tableId: 'table-v',
  branchId: 'branch-1',
  status: TableSessionStatus.OPEN,
  openedBySource: 'WAITER',
  openedAt: new Date('2026-07-07T12:00:00.000Z'),
  closeReason: null,
  closedAt: null,
  assignedStaffUserId: null,
  guestCount: 1,
  isCounter: true,
  bill: { id: 'bill-1', remainingAmount: new Prisma.Decimal('0') },
};

describe('counter session lifecycle', () => {
  const findUniqueMock = jest.fn();
  const transactionMock = jest.fn();
  const ensureAccessMock = jest.fn();
  const prisma = {
    tableSession: { findUnique: findUniqueMock },
    $transaction: transactionMock,
  } as unknown as PrismaService;
  const access = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  const tx = {
    tableSession: {
      update: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    bill: { update: jest.fn(), updateMany: jest.fn() },
    table: { update: jest.fn() },
    order: { count: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    transactionMock.mockImplementation(
      (callback: (client: unknown) => Promise<unknown>) => callback(tx),
    );
    tx.tableSession.update.mockResolvedValue({
      ...baseSession,
      status: TableSessionStatus.CLOSED,
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: [Role.WAITER],
    });
  });

  describe('close', () => {
    const service = new CloseTableSessionService(prisma, access);

    it('rejects with 409 while an order is still not delivered', async () => {
      findUniqueMock.mockResolvedValue(baseSession);
      tx.order.count.mockResolvedValue(1);

      await expect(
        service.execute(authUser, 'session-1', {}),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.order.count).toHaveBeenCalledWith({
        where: {
          tableSessionId: 'session-1',
          status: { notIn: ['CANCELLED', 'DELIVERED'] },
        },
      });
      expect(tx.tableSession.update).not.toHaveBeenCalled();
    });

    it('closes without touching the virtual table once everything is delivered', async () => {
      findUniqueMock.mockResolvedValue(baseSession);
      tx.order.count.mockResolvedValue(0);

      await service.execute(authUser, 'session-1', {});

      expect(tx.table.update).not.toHaveBeenCalled();
      expect(tx.bill.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: BillStatus.PAID }),
        }),
      );
    });
  });

  describe('abandon', () => {
    const service = new AbandonTableSessionService(prisma, access);

    it('lets a waiter abandon a counter session without freeing a table', async () => {
      findUniqueMock.mockResolvedValue(baseSession);
      tx.tableSession.update.mockResolvedValue({
        ...baseSession,
        status: TableSessionStatus.ABANDONED,
      });

      const result = await service.execute(authUser, 'session-1', {
        closeReason: 'Se fue',
      });

      expect(result.status).toBe(TableSessionStatus.ABANDONED);
      expect(tx.table.update).not.toHaveBeenCalled();
    });

    it('still forbids a waiter from abandoning a normal table session', async () => {
      findUniqueMock.mockResolvedValue({ ...baseSession, isCounter: false });

      await expect(
        service.execute(authUser, 'session-1', { closeReason: 'Se fue' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('stale auto-abandon', () => {
    const service = new AbandonStaleCounterSessionsService(prisma);
    const now = new Date('2026-07-08T12:00:00.000Z');

    it('abandons session and bill for counter sessions open for more than 12h', async () => {
      tx.tableSession.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
      tx.tableSession.updateMany.mockResolvedValue({ count: 2 });

      const count = await service.execute(now);

      expect(count).toBe(2);
      expect(tx.tableSession.findMany).toHaveBeenCalledWith({
        where: {
          isCounter: true,
          status: {
            in: [TableSessionStatus.OPEN, TableSessionStatus.PAYMENT_COMPLETED],
          },
          openedAt: { lt: new Date('2026-07-08T00:00:00.000Z') },
        },
        select: { id: true },
      });
      expect(tx.tableSession.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['s1', 's2'] },
          status: {
            in: [TableSessionStatus.OPEN, TableSessionStatus.PAYMENT_COMPLETED],
          },
        },
        data: {
          status: TableSessionStatus.ABANDONED,
          closeReason: 'auto-expired',
          closedAt: now,
        },
      });
      expect(tx.bill.updateMany).toHaveBeenCalledWith({
        where: {
          tableSessionId: { in: ['s1', 's2'] },
          status: { in: [BillStatus.OPEN, BillStatus.PARTIALLY_PAID] },
        },
        data: {
          status: BillStatus.ABANDONED,
          closeReason: 'auto-expired',
          closedAt: now,
        },
      });
    });

    it('does nothing when no session is stale', async () => {
      tx.tableSession.findMany.mockResolvedValue([]);

      expect(await service.execute(now)).toBe(0);
      expect(tx.tableSession.updateMany).not.toHaveBeenCalled();
    });
  });
});
