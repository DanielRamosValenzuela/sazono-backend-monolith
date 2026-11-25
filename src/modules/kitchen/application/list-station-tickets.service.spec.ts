import type { ConfigService } from '@nestjs/config';
import { OrderStatus, StationTicketStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { validateEnvironment } from '../../../common/config/validate-environment';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { ListStationTicketsService } from './list-station-tickets.service';

describe('ListStationTicketsService', () => {
  const NOW = new Date('2026-01-01T12:00:00.000Z');
  const findManyMock = jest.fn();
  const ensureAccessMock = jest.fn();
  const prisma = {
    stationTicket: { findMany: findManyMock },
    printJob: { findMany: jest.fn().mockResolvedValue([]) },
    printerStation: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
  const branchAccess = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;
  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  function build(env: Record<string, number> = {}) {
    const config = {
      get: (key: string, fallback: number) => env[key] ?? fallback,
    } as unknown as ConfigService;
    return new ListStationTicketsService(prisma, branchAccess, config);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    findManyMock.mockResolvedValue([]);
  });

  afterEach(() => jest.useRealTimers());

  it('limita READY a 10 minutos con borde inclusivo en exactamente 10', async () => {
    await build().execute(authUser, { branchId: 'b1' });

    const where = findManyMock.mock.calls[0][0].where;
    const readyClause = where.OR[0];
    const cutoff: Date = readyClause.completedAt.gte;

    expect(readyClause.status).toBe(StationTicketStatus.READY);
    expect(NOW.getTime() - cutoff.getTime()).toBe(10 * 60_000);
    const exactly = new Date(NOW.getTime() - 10 * 60_000);
    const justOver = new Date(NOW.getTime() - 10 * 60_000 - 1);
    const justUnder = new Date(NOW.getTime() - 10 * 60_000 + 1);
    expect(exactly >= cutoff).toBe(true);
    expect(justUnder >= cutoff).toBe(true);
    expect(justOver >= cutoff).toBe(false);
  });

  it('oculta tickets activos mas viejos que 12 horas por defecto', async () => {
    await build().execute(authUser, { branchId: 'b1' });

    const staleClause = findManyMock.mock.calls[0][0].where.OR[1];

    expect(staleClause.status).toEqual({ not: StationTicketStatus.READY });
    expect(NOW.getTime() - staleClause.createdAt.gte.getTime()).toBe(
      12 * 3_600_000,
    );
  });

  it('usa los valores configurados', async () => {
    await build({
      KITCHEN_READY_VISIBLE_MINUTES: 3,
      KITCHEN_STALE_TICKET_HOURS: 2,
    }).execute(authUser, { branchId: 'b1' });

    const [ready, stale] = findManyMock.mock.calls[0][0].where.OR;

    expect(NOW.getTime() - ready.completedAt.gte.getTime()).toBe(3 * 60_000);
    expect(NOW.getTime() - stale.createdAt.gte.getTime()).toBe(2 * 3_600_000);
  });

  it('filtra por estacion y excluye ordenes entregadas o canceladas', async () => {
    await build().execute(authUser, {
      branchId: 'b1',
      preparationStationId: 'st1',
    });

    const where = findManyMock.mock.calls[0][0].where;

    expect(where.branchId).toBe('b1');
    expect(where.preparationStationId).toBe('st1');
    expect(where.order.status.notIn).toEqual([
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
    ]);
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });

  it('valida roles de acceso', async () => {
    await build().execute(authUser, { branchId: 'b1' });

    expect(ensureAccessMock).toHaveBeenCalledWith(
      authUser,
      'b1',
      expect.arrayContaining(['KITCHEN', 'BAR']),
    );
  });
});

describe('validateEnvironment kitchen vars', () => {
  const base = {
    JWT_ACCESS_TOKEN_SECRET: 'a',
    JWT_REFRESH_TOKEN_SECRET: 'b',
  };

  it('aplica defaults', () => {
    const env = validateEnvironment(base);
    expect(env.KITCHEN_READY_VISIBLE_MINUTES).toBe(10);
    expect(env.KITCHEN_STALE_TICKET_HOURS).toBe(12);
  });

  it('acepta valores validos', () => {
    const env = validateEnvironment({
      ...base,
      KITCHEN_READY_VISIBLE_MINUTES: '1440',
      KITCHEN_STALE_TICKET_HOURS: '1',
    });
    expect(env.KITCHEN_READY_VISIBLE_MINUTES).toBe(1440);
    expect(env.KITCHEN_STALE_TICKET_HOURS).toBe(1);
  });

  it.each([
    ['KITCHEN_READY_VISIBLE_MINUTES', '0'],
    ['KITCHEN_READY_VISIBLE_MINUTES', '1441'],
    ['KITCHEN_READY_VISIBLE_MINUTES', '2.5'],
    ['KITCHEN_STALE_TICKET_HOURS', '721'],
    ['KITCHEN_STALE_TICKET_HOURS', '-1'],
  ])('rechaza %s=%s', (key, value) => {
    expect(() => validateEnvironment({ ...base, [key]: value })).toThrow();
  });
});
