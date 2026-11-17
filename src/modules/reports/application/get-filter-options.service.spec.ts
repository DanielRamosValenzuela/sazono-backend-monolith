import { ForbiddenException } from '@nestjs/common';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type {
  FilterOptionsRecord,
  ReportsPrismaRepository,
} from '../infrastructure/reports.prisma.repository';
import {
  GetFilterOptionsService,
  buildFilterOptions,
} from './get-filter-options.service';
import type { ReportScopeService } from './report-scope.service';

const authUser = {
  sub: 'auth-1',
  profileType: LoginProfileType.STAFF,
  profileId: 'staff-1',
  restaurantId: 'restaurant-1',
};

function record(extra: Partial<FilterOptionsRecord> = {}): FilterOptionsRecord {
  return {
    staff: [
      {
        id: 's1',
        name: 'Caro Cajera',
        status: 'ACTIVE',
        roles: ['CASHIER'],
        has_payments: true,
      },
      {
        id: 's2',
        name: 'Ex Mesero',
        status: 'DISABLED',
        roles: [],
        has_payments: false,
      },
    ],
    zones: [{ id: 'z1', name: 'Terraza' }],
    tables: [
      {
        id: 't1',
        name: 'Mesa 1',
        code: 'M1',
        zone_id: 'z1',
        is_virtual: false,
      },
    ],
    payments: {
      methods: ['CREDIT_CARD', 'CASH'],
      has_unclassified: true,
      providers: ['MANUAL'],
      sources: ['CASHIER', 'WEB_QR'],
    },
    categories: [
      { path: ['Cafe', 'Bebidas Calientes'], quantity: 5 },
      { path: ['Cafe'], quantity: 2 },
      { path: [], quantity: 1 },
    ],
    products: [
      {
        id: 'p1',
        name: 'Latte',
        path: ['Cafe', 'Bebidas Calientes'],
        quantity: 4,
      },
      { id: null, name: 'Huerfano', path: null, quantity: 1 },
    ],
    ...extra,
  };
}

describe('buildFilterOptions', () => {
  const since = new Date('2026-04-18T00:00:00.000Z');

  it('shapes staff, places, methods, categories and products for the filter controls', () => {
    const options = buildFilterOptions(record(), since);

    expect(options.windowDays).toBe(90);
    expect(options.since).toBe('2026-04-18T00:00:00.000Z');
    expect(options.staff).toEqual([
      {
        id: 's1',
        name: 'Caro Cajera',
        roles: ['CASHIER'],
        active: true,
        hasPayments: true,
      },
      {
        id: 's2',
        name: 'Ex Mesero',
        roles: [],
        active: false,
        hasPayments: false,
      },
    ]);
    expect(options.zones).toEqual([{ id: 'z1', name: 'Terraza' }]);
    expect(options.tables).toEqual([
      { id: 't1', name: 'Mesa 1', code: 'M1', zoneId: 'z1', isVirtual: false },
    ]);
    expect(options.providers).toEqual(['MANUAL']);
    expect(options.sources).toEqual(['CASHIER', 'WEB_QR']);
  });

  it('lists the methods in use in the canonical order, with the unclassified bucket last', () => {
    const options = buildFilterOptions(record(), since);

    expect(options.paymentMethods).toEqual([
      { method: 'CASH', label: 'Efectivo' },
      { method: 'CREDIT_CARD', label: 'Tarjeta de crédito' },
      { method: 'SIN_CLASIFICAR', label: 'Sin clasificar' },
    ]);
  });

  it('expands every category prefix once and adds up the quantities', () => {
    const options = buildFilterOptions(record(), since);

    expect(options.categories).toEqual([
      {
        path: ['(Sin categoria)'],
        label: '(Sin categoria)',
        level: 1,
        quantity: 1,
      },
      { path: ['Cafe'], label: 'Cafe', level: 1, quantity: 7 },
      {
        path: ['Cafe', 'Bebidas Calientes'],
        label: 'Cafe > Bebidas Calientes',
        level: 2,
        quantity: 5,
      },
    ]);
  });

  it('gives every product its category path and label, using the uncategorized fallback', () => {
    const options = buildFilterOptions(record(), since);

    expect(options.products).toEqual([
      {
        id: 'p1',
        name: 'Latte',
        categoryPath: ['Cafe', 'Bebidas Calientes'],
        categoryLabel: 'Cafe > Bebidas Calientes',
        quantity: 4,
      },
      {
        id: null,
        name: 'Huerfano',
        categoryPath: ['(Sin categoria)'],
        categoryLabel: '(Sin categoria)',
        quantity: 1,
      },
    ]);
  });

  it('copes with a branch that has no payments at all', () => {
    const options = buildFilterOptions(
      record({ payments: null, categories: [], products: [], staff: [] }),
      since,
    );

    expect(options.paymentMethods).toEqual([]);
    expect(options.providers).toEqual([]);
    expect(options.sources).toEqual([]);
    expect(options.categories).toEqual([]);
  });
});

describe('GetFilterOptionsService', () => {
  const resolveAccessMock = jest.fn();
  const findFilterOptionsMock = jest.fn();
  const service = new GetFilterOptionsService(
    { resolveAccess: resolveAccessMock } as unknown as ReportScopeService,
    {
      findFilterOptions: findFilterOptionsMock,
    } as unknown as ReportsPrismaRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-07-17T12:00:00.000Z'));
    findFilterOptionsMock.mockResolvedValue(record());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs one repository query with the 90 day window and no staff restriction for full access roles', async () => {
    resolveAccessMock.mockResolvedValue({
      timeZone: 'America/Santiago',
      cashierScoped: false,
      staffUserId: 'staff-1',
    });

    const options = await service.execute(authUser, 'branch-1');

    expect(findFilterOptionsMock).toHaveBeenCalledTimes(1);
    expect(findFilterOptionsMock).toHaveBeenCalledWith(
      'branch-1',
      new Date('2026-04-18T12:00:00.000Z'),
      null,
      500,
    );
    expect(options.since).toBe('2026-04-18T12:00:00.000Z');
  });

  it('restricts the staff list of a CASHIER to their own user', async () => {
    resolveAccessMock.mockResolvedValue({
      timeZone: 'America/Santiago',
      cashierScoped: true,
      staffUserId: 'staff-1',
    });

    await service.execute(authUser, 'branch-1');

    expect(findFilterOptionsMock.mock.calls[0][2]).toBe('staff-1');
  });

  it('rejects other roles before querying', async () => {
    resolveAccessMock.mockRejectedValue(new ForbiddenException());

    await expect(service.execute(authUser, 'branch-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(findFilterOptionsMock).not.toHaveBeenCalled();
  });
});
