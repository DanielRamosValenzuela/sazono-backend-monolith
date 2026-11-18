import { BadRequestException, ConflictException } from '@nestjs/common';
import { Role, TableSessionStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { OpenCounterSessionService } from './open-counter-session.service';
import { ListCounterSessionsService } from './list-counter-sessions.service';
import { RenameCounterSessionService } from './rename-counter-session.service';
import type { EnsureCounterTableService } from './ensure-counter-table.service';

jest.mock('../../billing/application/allocate-bill-number', () => ({
  allocateBillNumber: jest.fn().mockResolvedValue(7),
}));

const authUser = {
  sub: 'auth-1',
  profileType: LoginProfileType.STAFF,
  profileId: 'staff-1',
  restaurantId: 'restaurant-1',
};

const ensureAccess = jest.fn();
const access = { ensureAccess } as unknown as BranchAccessService;

beforeEach(() => {
  jest.resetAllMocks();
  ensureAccess.mockResolvedValue({
    staffUserId: 'staff-1',
    restaurantId: 'restaurant-1',
    branchId: 'branch-1',
    roles: [Role.WAITER],
  });
});

describe('OpenCounterSessionService', () => {
  const branchSettingsFindUnique = jest.fn();
  const transaction = jest.fn();
  const ensureTable = jest.fn();
  const prisma = {
    branchSettings: { findUnique: branchSettingsFindUnique },
    $transaction: transaction,
  } as unknown as PrismaService;
  const service = new OpenCounterSessionService(prisma, access, {
    execute: ensureTable,
  } as unknown as EnsureCounterTableService);

  function mockTx(opts: {
    tickets: number[];
    taken?: number[];
    createError?: Error;
  }) {
    const queryRaw = jest.fn();
    opts.tickets.forEach((n) =>
      queryRaw.mockResolvedValueOnce([{ counter_last_ticket: n }]),
    );
    const sessionCreate = opts.createError
      ? jest.fn().mockRejectedValue(opts.createError)
      : jest.fn().mockImplementation(({ data }: { data: object }) => ({
          id: 'session-1',
          tableId: 'table-v',
          branchId: 'branch-1',
          status: TableSessionStatus.OPEN,
          openedByStaffUserId: 'staff-1',
          assignedStaffUserId: null,
          openedAt: new Date('2026-08-01T10:00:00.000Z'),
          customerLabel: null,
          ...data,
        }));
    const billCreate = jest.fn().mockResolvedValue({ id: 'bill-1' });
    const findMany = jest
      .fn()
      .mockResolvedValue((opts.taken ?? []).map((n) => ({ ticketNumber: n })));
    transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb({
        $queryRaw: queryRaw,
        tableSession: { create: sessionCreate, findMany },
        bill: { create: billCreate },
      }),
    );
    return { queryRaw, sessionCreate, billCreate };
  }

  beforeEach(() => {
    ensureTable.mockResolvedValue({ id: 'table-v' });
    branchSettingsFindUnique.mockResolvedValue({
      tableAssignmentEnabled: false,
    });
  });

  it('opens a counter session with a ticket and an OPEN bill', async () => {
    const { sessionCreate, billCreate } = mockTx({ tickets: [7] });

    const result = await service.execute(authUser, {
      branchId: 'branch-1',
      customerLabel: 'Ana',
    });

    expect(result).toMatchObject({
      tableSessionId: 'session-1',
      billId: 'bill-1',
      ticketNumber: 7,
      customerLabel: 'Ana',
    });
    const data = (
      sessionCreate.mock.calls[0] as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data).toMatchObject({
      isCounter: true,
      ticketNumber: 7,
      guestCount: 1,
      openedByStaffUserId: 'staff-1',
      assignedStaffUserId: null,
      tableId: 'table-v',
    });
    expect(billCreate).toHaveBeenCalledTimes(1);
  });

  it('assigns the opener when table assignment is enabled', async () => {
    branchSettingsFindUnique.mockResolvedValue({
      tableAssignmentEnabled: true,
    });
    const { sessionCreate } = mockTx({ tickets: [1] });

    await service.execute(authUser, { branchId: 'branch-1' });

    const data = (
      sessionCreate.mock.calls[0] as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data.assignedStaffUserId).toBe('staff-1');
    expect(data.customerLabel).toBeNull();
  });

  it('skips tickets held by active counter sessions', async () => {
    const { sessionCreate, queryRaw } = mockTx({
      tickets: [5, 6, 7],
      taken: [5, 6],
    });

    const result = await service.execute(authUser, { branchId: 'branch-1' });

    expect(result.ticketNumber).toBe(7);
    expect(queryRaw).toHaveBeenCalledTimes(3);
    expect(sessionCreate).toHaveBeenCalledTimes(1);
  });

  it('rejects with 409 when all 999 tickets are active', async () => {
    mockTx({
      tickets: [1],
      taken: Array.from({ length: 999 }, (_, i) => i + 1),
    });

    await expect(
      service.execute(authUser, { branchId: 'branch-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps a unique violation to 409', async () => {
    mockTx({
      tickets: [1],
      createError: new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    });

    await expect(
      service.execute(authUser, { branchId: 'branch-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('never allows the kitchen role', async () => {
    mockTx({ tickets: [1] });
    await service.execute(authUser, { branchId: 'branch-1' });
    const roles = ensureAccess.mock.calls[0][2] as Role[];
    expect(roles).not.toContain(Role.KITCHEN);
    expect(roles).toEqual(
      expect.arrayContaining([
        Role.ADMIN,
        Role.SUPERVISOR,
        Role.WAITER,
        Role.CASHIER,
      ]),
    );
  });
});

describe('ListCounterSessionsService', () => {
  const findMany = jest.fn();
  const service = new ListCounterSessionsService(
    { tableSession: { findMany } } as unknown as PrismaService,
    access,
  );

  const decimal = (v: string) => new Prisma.Decimal(v);

  it('lists active counter sessions with bill and readiness, filtering mine', async () => {
    findMany.mockResolvedValue([
      {
        id: 's1',
        ticketNumber: 3,
        customerLabel: 'Ana',
        status: TableSessionStatus.OPEN,
        openedByStaffUserId: 'staff-1',
        openedAt: new Date('2026-08-01T10:00:00.000Z'),
        bill: {
          id: 'b1',
          status: 'OPEN',
          totalAmount: decimal('4500'),
          remainingAmount: decimal('1000'),
        },
        orders: [
          {
            id: 'o1',
            status: 'READY',
            updatedAt: new Date('2026-08-01T10:05:00.000Z'),
          },
          {
            id: 'o2',
            status: 'CANCELLED',
            updatedAt: new Date('2026-08-01T10:06:00.000Z'),
          },
        ],
      },
    ]);

    const result = await service.execute(authUser, {
      branchId: 'branch-1',
      mine: true,
    });

    const where = (findMany.mock.calls[0] as [{ where: object }])[0].where;
    expect(where).toMatchObject({
      branchId: 'branch-1',
      isCounter: true,
      openedByStaffUserId: 'staff-1',
    });
    expect(result[0]).toMatchObject({
      tableSessionId: 's1',
      billId: 'b1',
      ticketNumber: 3,
      bill: { total: '4500', paid: '3500', remaining: '1000' },
      readiness: 'READY',
      readyAt: '2026-08-01T10:05:00.000Z',
    });
    expect(result[0].orders).toHaveLength(2);
  });

  it('does not filter by opener without mine', async () => {
    findMany.mockResolvedValue([]);
    await service.execute(authUser, { branchId: 'branch-1' });
    const where = (findMany.mock.calls[0] as [{ where: object }])[0].where;
    expect(where).not.toHaveProperty('openedByStaffUserId');
  });
});

describe('RenameCounterSessionService', () => {
  const findUnique = jest.fn();
  const update = jest.fn();
  const service = new RenameCounterSessionService(
    { tableSession: { findUnique, update } } as unknown as PrismaService,
    access,
  );

  it('rejects non-counter sessions', async () => {
    findUnique.mockResolvedValue({ id: 's1', isCounter: false });
    await expect(
      service.execute(authUser, 's1', { customerLabel: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects closed sessions', async () => {
    findUnique.mockResolvedValue({
      id: 's1',
      isCounter: true,
      branchId: 'branch-1',
      status: TableSessionStatus.CLOSED,
    });
    await expect(
      service.execute(authUser, 's1', { customerLabel: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('renames and clears empty labels', async () => {
    findUnique.mockResolvedValue({
      id: 's1',
      isCounter: true,
      branchId: 'branch-1',
      status: TableSessionStatus.OPEN,
      bill: { id: 'b1' },
    });
    update.mockResolvedValue({
      id: 's1',
      tableId: 't',
      branchId: 'branch-1',
      ticketNumber: 3,
      customerLabel: null,
      status: TableSessionStatus.OPEN,
      openedByStaffUserId: 'staff-1',
      assignedStaffUserId: null,
      openedAt: new Date('2026-08-01T10:00:00.000Z'),
    });

    const result = await service.execute(authUser, 's1', {
      customerLabel: '',
    });

    expect(
      (update.mock.calls[0] as [{ data: { customerLabel: null } }])[0].data
        .customerLabel,
    ).toBeNull();
    expect(result.billId).toBe('b1');
  });
});
