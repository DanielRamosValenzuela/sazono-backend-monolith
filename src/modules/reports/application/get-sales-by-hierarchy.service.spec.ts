import { BadRequestException } from '@nestjs/common';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type {
  HierarchyLineRecord,
  ReportsPrismaRepository,
} from '../infrastructure/reports.prisma.repository';
import {
  GetSalesByHierarchyService,
  SALES_BY_HIERARCHY_CSV_HEADERS,
  hierarchyToCsvRows,
} from './get-sales-by-hierarchy.service';
import { buildHierarchyView, encodeNodeId } from './hierarchy-tree';
import { csvLine } from './report-csv';
import type { ReportScopeService } from './report-scope.service';
import { EMPTY_FILTERS, type ReportScope } from './report-types';

const BOM = String.fromCharCode(0xfeff);

const authUser = {
  sub: 'auth-1',
  profileType: LoginProfileType.STAFF,
  profileId: 'staff-1',
  restaurantId: 'restaurant-1',
};

const scope: ReportScope = {
  branchId: 'branch-1',
  timeZone: 'America/Santiago',
  from: '2026-07-14',
  to: '2026-07-15',
  start: new Date('2026-07-14T04:00:00.000Z'),
  end: new Date('2026-07-16T04:00:00.000Z'),
  cashierId: null,
  methods: [],
  cashierScoped: false,
  filters: EMPTY_FILTERS,
};

function record(
  path: string[] | null,
  itemName: string,
  amount: number,
  quantity: number,
  cancelled = 0,
): HierarchyLineRecord {
  return {
    category_path: path,
    item_name: itemName,
    station_name: 'Barra',
    amount,
    quantity,
    cancelled_quantity: cancelled,
  };
}

describe('hierarchyToCsvRows', () => {
  it('neutralises names that start like a formula', () => {
    const rows = hierarchyToCsvRows({
      from: '2026-07-14',
      to: '2026-07-14',
      timeZone: 'America/Santiago',
      parentId: null,
      breadcrumb: [],
      groupBy: 'category',
      includeModifiers: true,
      nodes: buildHierarchyView(
        [
          {
            path: ['=SUM(A1)'],
            itemName: 'x',
            stationName: 'Barra',
            amount: 100,
            quantity: 1,
            cancelledQuantity: 0,
          },
        ],
        'category',
        null,
      ).nodes,
      totals: { amount: '100', quantity: 1 },
      refunds: { consumption: '0', tip: '0' },
    });

    expect(csvLine(rows[0])).toBe(
      "'=SUM(A1);Categoria;1;100;1;100,00;0;100\r\n",
    );
  });
});

describe('GetSalesByHierarchyService', () => {
  const resolveMock = jest.fn();
  const findHierarchyLinesMock = jest.fn();
  const findPeriodRefundTotalsMock = jest.fn();
  const service = new GetSalesByHierarchyService(
    { resolve: resolveMock } as unknown as ReportScopeService,
    {
      findHierarchyLines: findHierarchyLinesMock,
      findPeriodRefundTotals: findPeriodRefundTotalsMock,
    } as unknown as ReportsPrismaRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findPeriodRefundTotalsMock.mockResolvedValue({ consumption: 0, tip: 0 });
    resolveMock.mockResolvedValue(scope);
    findHierarchyLinesMock.mockResolvedValue([
      record(['Cafe', 'Bebidas Calientes'], 'Latte', 7000, 2),
      record(['Cafe'], '=HYPERLINK("x")', 1000, 1, 2),
      record([], 'Huerfano', 500, 1),
      record(null, 'Huerfano', 500, 1),
    ]);
  });

  it('resolves the scope for full access roles only and for the requested range', async () => {
    await service.execute(authUser, 'branch-1', {
      from: '2026-07-14',
      to: '2026-07-15',
    });

    expect(resolveMock).toHaveBeenCalledWith(
      authUser,
      'branch-1',
      { from: '2026-07-14', to: '2026-07-15' },
      { forCsv: false, fullAccessOnly: true },
    );
  });

  it('defaults to groupBy category with modifiers included and returns the contract shape', async () => {
    const response = await service.execute(authUser, 'branch-1', {
      from: '2026-07-14',
      to: '2026-07-15',
    });

    expect(findHierarchyLinesMock).toHaveBeenCalledWith({
      ...EMPTY_FILTERS,
      branchId: 'branch-1',
      start: scope.start,
      end: scope.end,
      timeZone: 'America/Santiago',
      cashierId: null,
      methods: [],
      includeModifiers: true,
    });
    expect(response).toMatchObject({
      from: '2026-07-14',
      to: '2026-07-15',
      timeZone: 'America/Santiago',
      parentId: null,
      breadcrumb: [],
      groupBy: 'category',
      includeModifiers: true,
      totals: { amount: '9000', quantity: 5 },
    });
    expect(Object.keys(response.nodes[0]).sort()).toEqual(
      [
        'amount',
        'averagePrice',
        'cancelledQuantity',
        'hasChildren',
        'id',
        'kind',
        'level',
        'name',
        'path',
        'quantity',
        'share',
      ].sort(),
    );
    expect(response.nodes.map((node) => [node.name, node.amount])).toEqual([
      ['Cafe', '8000'],
      ['(Sin categoria)', '1000'],
    ]);
  });

  it('passes includeModifiers=false to the repository', async () => {
    const response = await service.execute(authUser, 'branch-1', {
      from: '2026-07-14',
      to: '2026-07-15',
      includeModifiers: 'false',
    });

    expect(findHierarchyLinesMock.mock.calls[0][0]).toMatchObject({
      includeModifiers: false,
    });
    expect(response.includeModifiers).toBe(false);
  });

  it('drills down with a parentId and echoes it with the breadcrumb', async () => {
    const parentId = encodeNodeId('c', ['Cafe']);
    const response = await service.execute(authUser, 'branch-1', {
      from: '2026-07-14',
      to: '2026-07-15',
      parentId,
    });

    expect(response.parentId).toBe(parentId);
    expect(response.breadcrumb).toEqual([{ id: parentId, name: 'Cafe' }]);
    expect(response.nodes.map((node) => [node.kind, node.name])).toEqual([
      ['category', 'Bebidas Calientes'],
      ['item', '=HYPERLINK("x")'],
    ]);
    expect(response.totals.amount).toBe('8000');
  });

  it('rejects a malformed parentId with 400 before querying', async () => {
    await expect(
      service.execute(authUser, 'branch-1', {
        from: '2026-07-14',
        to: '2026-07-15',
        parentId: 'not-a-node',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findHierarchyLinesMock).not.toHaveBeenCalled();
  });

  it('ignores parentId for flat groupings', async () => {
    const response = await service.execute(authUser, 'branch-1', {
      from: '2026-07-14',
      to: '2026-07-15',
      groupBy: 'station',
      parentId: 'garbage',
    });

    expect(response.parentId).toBeNull();
    expect(response.nodes.map((node) => node.name)).toEqual(['Barra']);
    expect(response.totals.amount).toBe('9000');
  });

  it('item level total equals the category level total', async () => {
    const byCategory = await service.execute(authUser, 'branch-1', {
      from: '2026-07-14',
      to: '2026-07-15',
    });
    const byItem = await service.execute(authUser, 'branch-1', {
      from: '2026-07-14',
      to: '2026-07-15',
      groupBy: 'item',
    });

    expect(byItem.totals).toEqual(byCategory.totals);
  });

  it('propagates scope errors such as a forbidden role without querying', async () => {
    resolveMock.mockRejectedValue(new Error('forbidden'));

    await expect(service.execute(authUser, 'branch-1', {})).rejects.toThrow(
      'forbidden',
    );
    expect(findHierarchyLinesMock).not.toHaveBeenCalled();
  });

  it('exports the current view as csv with BOM, semicolons, Spanish headers and neutralised formulas', async () => {
    const download = await service.executeCsv(authUser, 'branch-1', {
      from: '2026-07-14',
      to: '2026-07-15',
      parentId: encodeNodeId('c', ['Cafe']),
    });
    let text = '';

    for await (const chunk of download.stream) {
      text += String(chunk);
    }

    expect(resolveMock.mock.calls[0][3]).toEqual({
      forCsv: true,
      fullAccessOnly: true,
    });
    expect(download.filename).toBe(
      'jerarquia-ventas_branch-1_2026-07-14_2026-07-15.csv',
    );
    expect(
      text.startsWith(BOM + SALES_BY_HIERARCHY_CSV_HEADERS.join(';')),
    ).toBe(true);
    expect(text.split(BOM)).toHaveLength(2);

    const lines = text.trimEnd().split('\r\n');

    expect(lines[0]).toBe(
      BOM +
        'Jerarquia;Tipo;Nivel;Monto;Cantidad;Participacion (%);Anulado;Precio promedio',
    );
    expect(lines[1]).toBe(
      'Cafe > Bebidas Calientes;Categoria;2;7000;2;87,50;0;3500',
    );
    expect(lines[2]).toBe(
      '"Cafe > =HYPERLINK(""x"")";Producto;2;1000;1;12,50;2;1000',
    );
    expect(lines[lines.length - 2]).toBe('TOTAL;;;8000;3;;2;');
    expect(lines[lines.length - 1]).toBe(
      'REEMBOLSOS (no asignados a productos);;;0;;;;',
    );
  });

  describe('refunds', () => {
    const totals = { consumption: 3500, tip: 273 };

    it('adds the refunded consumption and tip of the same eligible set as a separate block', async () => {
      findPeriodRefundTotalsMock.mockResolvedValue(totals);

      const response = await service.execute(authUser, 'branch-1', {
        from: '2026-07-14',
        to: '2026-07-15',
      });

      expect(response.refunds).toEqual({ consumption: '3500', tip: '273' });
      expect(findPeriodRefundTotalsMock.mock.calls[0][0]).toMatchObject({
        branchId: 'branch-1',
        start: scope.start,
        end: scope.end,
      });
    });

    it('keeps nodes and totals identical with and without refunds', async () => {
      const query = { from: '2026-07-14', to: '2026-07-15' };
      const without = await service.execute(authUser, 'branch-1', query);
      findPeriodRefundTotalsMock.mockResolvedValue(totals);
      const withRefunds = await service.execute(authUser, 'branch-1', query);

      expect(withRefunds.nodes).toEqual(without.nodes);
      expect(withRefunds.totals).toEqual(without.totals);
      expect(without.refunds).toEqual({ consumption: '0', tip: '0' });
    });

    it('adds the unassigned refunds row after TOTAL in the CSV', async () => {
      findPeriodRefundTotalsMock.mockResolvedValue(totals);

      const response = await service.execute(authUser, 'branch-1', {
        from: '2026-07-14',
        to: '2026-07-15',
      });
      const rows = hierarchyToCsvRows(response);
      const last = rows[rows.length - 1];

      expect(last[0]).toBe('REEMBOLSOS (no asignados a productos)');
      expect(last[3]).toBe(3500);
      expect(rows[rows.length - 2][0]).toBe('TOTAL');
    });
  });
});
