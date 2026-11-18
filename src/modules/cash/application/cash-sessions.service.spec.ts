import { CashMovementType, Prisma, Role } from '@prisma/client';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { CashMovementsService } from './cash-movements.service';
import { CashSessionsService } from './cash-sessions.service';

const authUser = {
  sub: 'a',
  profileType: LoginProfileType.STAFF,
  profileId: 's1',
  restaurantId: 'r1',
};
const meta = { ip: null, userAgent: null };
const D = (value: number) => new Prisma.Decimal(value);

function sessionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs1',
    branchId: 'b1',
    registerLabel: 'Caja 1',
    status: 'OPEN',
    cashierStaffUserId: 's1',
    openedAt: new Date('2026-11-18T12:00:00Z'),
    closedAt: null,
    forced: false,
    openingFloat: D(20000),
    expectedCash: null,
    cashSalesAmount: null,
    movementsAmount: null,
    countedCash: null,
    difference: null,
    closingNote: null,
    denominations: null,
    cashier: { firstName: 'Ana', lastName: 'Cajera' },
    closedBy: null,
    ...overrides,
  };
}

function build(roles: Role[] = [Role.CASHIER]) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'cs1' }]),
    cashSession: {
      create: jest.fn().mockResolvedValue(sessionRecord()),
      findUniqueOrThrow: jest.fn().mockResolvedValue(sessionRecord()),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(
            sessionRecord({
              ...data,
              status: 'CLOSED',
              closedAt: new Date(),
              cashSalesAmount: data.cashSalesAmount,
            }),
          ),
        ),
    },
    payment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: D(50000) } }),
    },
    cashMovement: {
      groupBy: jest
        .fn()
        .mockResolvedValue([
          { type: CashMovementType.CASH_OUT, _sum: { amount: D(-5000) } },
        ]),
    },
    bill: { count: jest.fn().mockResolvedValue(2) },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) =>
      cb(tx),
    ) as jest.Mock,
    cashSession: {
      ...tx.cashSession,
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const access = {
    ensureAccess: jest.fn().mockResolvedValue({
      staffUserId: 's1',
      restaurantId: 'r1',
      branchId: 'b1',
      roles,
    }),
  };
  const audit = { record: jest.fn() };
  const service = new CashSessionsService(
    prisma as never,
    access as never,
    audit as never,
  );

  return { service, tx, prisma, audit, access };
}

describe('CashSessionsService', () => {
  it('opens a session and audits it', async () => {
    const { service, audit } = build();
    const result = await service.open(
      authUser,
      'b1',
      { openingFloat: '20000' },
      meta,
    );

    expect(result.expectedCash).toBe('20000');
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'CASH_SESSION_OPENED' }),
    );
  });

  it('returns the existing session when the same cashier retries the same opening', async () => {
    const { service, prisma } = build();
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    prisma.cashSession.findMany.mockResolvedValue([sessionRecord()]);
    const result = await service.open(
      authUser,
      'b1',
      { openingFloat: '20000' },
      meta,
    );

    expect(result.id).toBe('cs1');
  });

  it('rejects an opening race lost to another cashier on the same register', async () => {
    const { service, prisma } = build();
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    prisma.cashSession.findMany.mockResolvedValue([
      sessionRecord({ cashierStaffUserId: 's2' }),
    ]);

    await expect(
      service.open(authUser, 'b1', { openingFloat: '20000' }, meta),
    ).rejects.toMatchObject({
      response: { code: 'CASH_SESSION_ALREADY_OPEN' },
    });
  });

  it('rejects when the cashier already has another register open', async () => {
    const { service, prisma } = build();
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    prisma.cashSession.findMany.mockResolvedValue([
      sessionRecord({ registerLabel: 'Barra' }),
    ]);

    await expect(
      service.open(authUser, 'b1', { openingFloat: '20000' }, meta),
    ).rejects.toMatchObject({
      response: { code: 'CASHIER_HAS_OPEN_SESSION' },
    });
  });

  it('closes with expected = float + cash sales + signed movements and stores the difference', async () => {
    const { service, tx } = build();
    const result = await service.close(
      authUser,
      'b1',
      'cs1',
      { countedCash: '64000', closingNote: 'faltaron 1000' },
      meta,
    );

    expect(tx.cashSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          expectedCash: D(65000),
          difference: D(-1000),
          movementsAmount: D(-5000),
        }),
      }),
    );
    expect(result.warnings).toEqual({
      openBills: 2,
      partialBillsCollectedInSession: 2,
    });
  });

  it('requires a note when there is a difference', async () => {
    const { service } = build();

    await expect(
      service.close(authUser, 'b1', 'cs1', { countedCash: '64000' }, meta),
    ).rejects.toMatchObject({
      response: { code: 'CASH_SESSION_NOTE_REQUIRED' },
    });
  });

  it('closes without note when counted equals expected', async () => {
    const { service } = build();
    const result = await service.close(
      authUser,
      'b1',
      'cs1',
      { countedCash: '65000' },
      meta,
    );

    expect(result.session.difference).toBe('0');
  });

  it('blocks a cashier closing someone elses session', async () => {
    const { service, tx } = build();
    tx.cashSession.findUniqueOrThrow.mockResolvedValue(
      sessionRecord({ cashierStaffUserId: 's2' }),
    );

    await expect(
      service.close(authUser, 'b1', 'cs1', { countedCash: '65000' }, meta),
    ).rejects.toMatchObject({ response: { code: 'CASH_SESSION_NOT_OWNER' } });
  });

  it('rejects closing an already closed session', async () => {
    const { service, tx } = build();
    tx.cashSession.findUniqueOrThrow.mockResolvedValue(
      sessionRecord({ status: 'CLOSED' }),
    );

    await expect(
      service.close(authUser, 'b1', 'cs1', { countedCash: '0' }, meta),
    ).rejects.toMatchObject({
      response: { code: 'CASH_SESSION_ALREADY_CLOSED' },
    });
  });

  it('force close needs a reason and marks the session forced', async () => {
    const { service, tx } = build([Role.SUPERVISOR]);
    tx.cashSession.findUniqueOrThrow.mockResolvedValue(
      sessionRecord({ cashierStaffUserId: 's2' }),
    );

    await expect(
      service.forceClose(authUser, 'b1', 'cs1', { countedCash: '65000' }, meta),
    ).rejects.toMatchObject({
      response: { code: 'CASH_SESSION_NOTE_REQUIRED' },
    });

    await service.forceClose(
      authUser,
      'b1',
      'cs1',
      { countedCash: '65000', closingNote: 'turno olvidado' },
      meta,
    );

    expect(tx.cashSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ forced: true }),
      }),
    );
  });

  it('rejects invalid denominations', async () => {
    const { service } = build();

    await expect(
      service.close(
        authUser,
        'b1',
        'cs1',
        { countedCash: '65000', denominations: { abc: 2 } },
        meta,
      ),
    ).rejects.toMatchObject({
      response: { code: 'CASH_DENOMINATIONS_INVALID' },
    });
  });
});

describe('CashMovementsService', () => {
  function buildMovements(options: { session?: boolean; require?: boolean }) {
    const created = {
      id: 'm1',
      type: CashMovementType.CASH_OUT,
      amount: D(-5000),
      reason: 'Hielo',
      cashSessionId: options.session === false ? null : 'cs1',
      staffUserId: 's1',
      createdAt: new Date('2026-11-18T13:00:00Z'),
      staffUser: { firstName: 'Ana', lastName: 'Cajera' },
    };
    const tx = {
      cashMovement: { create: jest.fn().mockResolvedValue(created) },
      $queryRaw: jest
        .fn()
        .mockResolvedValue(options.session === false ? [] : [{ id: 'cs1' }]),
      cashSession: { findFirst: jest.fn().mockResolvedValue(null) },
      branchSettings: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ requireOpenCashSession: !!options.require }),
      },
    };
    const prisma = {
      cashMovement: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const access = {
      ensureAccess: jest.fn().mockResolvedValue({
        staffUserId: 's1',
        restaurantId: 'r1',
        branchId: 'b1',
        roles: [Role.CASHIER],
      }),
    };
    const audit = { record: jest.fn() };
    const service = new CashMovementsService(
      prisma as never,
      access as never,
      audit as never,
    );

    return { service, tx, prisma, audit, created };
  }

  it('stores CASH_OUT as a negative amount linked to the open session', async () => {
    const { service, tx, audit } = buildMovements({});
    const result = await service.create(
      authUser,
      'b1',
      'key-12345678',
      { type: 'CASH_OUT', amount: '5000', reason: 'Hielo' },
      meta,
    );

    expect(tx.cashMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: D(-5000),
          cashSessionId: 'cs1',
          idempotencyKey: 'key-12345678',
        }),
      }),
    );
    expect(result.amount).toBe('-5000');
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'CASH_MOVEMENT_CREATED' }),
    );
  });

  it('stores CASH_IN as positive', async () => {
    const { service, tx } = buildMovements({});

    await service.create(
      authUser,
      'b1',
      'key-12345678',
      { type: 'CASH_IN', amount: '3000', reason: 'Cambio' },
      meta,
    );

    expect(tx.cashMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: D(3000) }),
      }),
    );
  });

  it('records without session when none is open and it is not required', async () => {
    const { service, tx } = buildMovements({ session: false });

    await service.create(
      authUser,
      'b1',
      'key-12345678',
      { type: 'CASH_OUT', amount: '5000', reason: 'Hielo' },
      meta,
    );

    expect(tx.cashMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cashSessionId: null }),
      }),
    );
  });

  it('requires an open session when the branch demands it', async () => {
    const { service } = buildMovements({ session: false, require: true });

    await expect(
      service.create(
        authUser,
        'b1',
        'key-12345678',
        { type: 'CASH_OUT', amount: '5000', reason: 'Hielo' },
        meta,
      ),
    ).rejects.toMatchObject({ response: { code: 'CASH_SESSION_REQUIRED' } });
  });

  it('replays an identical request and rejects a reused key with other data', async () => {
    const { service, prisma, created, tx } = buildMovements({});
    prisma.cashMovement.findFirst.mockResolvedValue(created);

    const replayed = await service.create(
      authUser,
      'b1',
      'key-12345678',
      { type: 'CASH_OUT', amount: '5000', reason: 'Hielo' },
      meta,
    );

    expect(replayed.id).toBe('m1');
    expect(tx.cashMovement.create).not.toHaveBeenCalled();

    await expect(
      service.create(
        authUser,
        'b1',
        'key-12345678',
        { type: 'CASH_OUT', amount: '9000', reason: 'Hielo' },
        meta,
      ),
    ).rejects.toMatchObject({
      response: { code: 'CASH_IDEMPOTENCY_KEY_REUSED' },
    });
  });

  it('locks and links an explicit session, and maps closed or missing ones', async () => {
    const { service, tx } = buildMovements({});

    await service.createAdjustment(
      authUser,
      'b1',
      'key-12345678',
      { amount: '-500', reason: 'Ajuste', cashSessionId: 'cs1' },
      meta,
    );

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.cashMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cashSessionId: 'cs1' }),
      }),
    );

    tx.$queryRaw.mockResolvedValue([]);
    tx.cashSession.findFirst.mockResolvedValueOnce({ id: 'cs1' });
    await expect(
      service.createAdjustment(
        authUser,
        'b1',
        'key-12345679',
        { amount: '-500', reason: 'Ajuste', cashSessionId: 'cs1' },
        meta,
      ),
    ).rejects.toMatchObject({
      response: { code: 'CASH_SESSION_ALREADY_CLOSED' },
    });
    await expect(
      service.createAdjustment(
        authUser,
        'b1',
        'key-12345679',
        { amount: '-500', reason: 'Ajuste', cashSessionId: 'cs1' },
        meta,
      ),
    ).rejects.toMatchObject({
      response: { code: 'CASH_SESSION_NOT_FOUND' },
    });
  });

  it('rejects an adjustment replay that targets another session', async () => {
    const { service, prisma, created } = buildMovements({});
    prisma.cashMovement.findFirst.mockResolvedValue({
      ...created,
      type: CashMovementType.ADJUSTMENT,
      amount: D(-500),
      reason: 'Ajuste',
    });
    const body = { amount: '-500', reason: 'Ajuste' };

    await expect(
      service.createAdjustment(
        authUser,
        'b1',
        'key-12345678',
        { ...body, cashSessionId: 'cs2' },
        meta,
      ),
    ).rejects.toMatchObject({
      response: { code: 'CASH_IDEMPOTENCY_KEY_REUSED' },
    });

    const replayed = await service.createAdjustment(
      authUser,
      'b1',
      'key-12345678',
      { ...body, cashSessionId: 'cs1' },
      meta,
    );

    expect(replayed.id).toBe('m1');
  });
});

describe('CashSessionsService closed figures', () => {
  it('serves stored sales and movements for a closed session', async () => {
    const { service, prisma } = build();
    prisma.cashSession.findMany.mockResolvedValue([
      sessionRecord({
        status: 'CLOSED',
        cashSalesAmount: D(40000),
        movementsAmount: D(-1000),
        expectedCash: D(59000),
      }),
    ]);

    const {
      sessions: [session],
    } = await service.list(authUser, 'b1', {});

    expect(session.cashSalesAmount).toBe('40000');
    expect(session.movementsAmount).toBe('-1000');
    expect(session.expectedCash).toBe('59000');
  });
});
