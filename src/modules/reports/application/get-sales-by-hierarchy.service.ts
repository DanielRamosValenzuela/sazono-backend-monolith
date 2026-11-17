import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  ReportsPrismaRepository,
  type HierarchyLineRecord,
} from '../infrastructure/reports.prisma.repository';
import type { CsvDownload } from './get-sales-by-order.service';
import {
  buildHierarchyView,
  decodeCategoryNodeId,
  normalizePath,
  type HierarchyBreadcrumb,
  type HierarchyGroupBy,
  type HierarchyLine,
  type HierarchyNode,
} from './hierarchy-tree';
import { csvStream, type CsvCell } from './report-csv';
import {
  ReportScopeService,
  type ReportScopeQuery,
} from './report-scope.service';
import type { ReportScope } from './report-types';

export type SalesByHierarchyQuery = Pick<
  ReportScopeQuery,
  | 'from'
  | 'to'
  | 'cashierId'
  | 'method'
  | 'waiterId'
  | 'tableId'
  | 'zoneId'
  | 'source'
  | 'timeFrom'
  | 'timeTo'
  | 'weekdays'
> & {
  parentId?: string;
  groupBy?: HierarchyGroupBy;
  includeModifiers?: 'true' | 'false';
};

export type SalesByHierarchyResponse = {
  from: string;
  to: string;
  timeZone: string;
  parentId: string | null;
  breadcrumb: HierarchyBreadcrumb[];
  groupBy: HierarchyGroupBy;
  includeModifiers: boolean;
  nodes: HierarchyNode[];
  totals: { amount: string; quantity: number };
};

export const SALES_BY_HIERARCHY_CSV_HEADERS = [
  'Jerarquia',
  'Tipo',
  'Nivel',
  'Monto',
  'Cantidad',
  'Participacion (%)',
  'Anulado',
  'Precio promedio',
];

const PATH_SEPARATOR = ' > ';

export function toHierarchyLines(
  records: HierarchyLineRecord[],
): HierarchyLine[] {
  return records.map((record) => ({
    path: normalizePath(record.category_path),
    itemName: record.item_name,
    stationName: record.station_name,
    amount: record.amount,
    quantity: record.quantity,
    cancelledQuantity: record.cancelled_quantity,
  }));
}

function kindLabel(node: HierarchyNode, groupBy: HierarchyGroupBy): string {
  if (groupBy === 'station') {
    return 'Estacion';
  }

  return node.kind === 'item' ? 'Producto' : 'Categoria';
}

export function hierarchyToCsvRows(
  response: SalesByHierarchyResponse,
): CsvCell[][] {
  const formatShare = (share: number): string =>
    share.toFixed(2).replace('.', ',');
  const rows: CsvCell[][] = response.nodes.map((node) => [
    node.path.join(PATH_SEPARATOR),
    kindLabel(node, response.groupBy),
    node.level,
    Number(node.amount),
    node.quantity,
    formatShare(node.share),
    node.cancelledQuantity,
    Number(node.averagePrice),
  ]);

  rows.push([
    'TOTAL',
    '',
    null,
    Number(response.totals.amount),
    response.totals.quantity,
    '',
    response.nodes.reduce((sum, node) => sum + node.cancelledQuantity, 0),
    '',
  ]);

  return rows;
}

@Injectable()
export class GetSalesByHierarchyService {
  constructor(
    private readonly scopeService: ReportScopeService,
    private readonly reportsRepository: ReportsPrismaRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
    query: SalesByHierarchyQuery,
  ): Promise<SalesByHierarchyResponse> {
    const scope = await this.scopeService.resolve(authUser, branchId, query, {
      forCsv: false,
      fullAccessOnly: true,
    });

    return this.build(scope, query);
  }

  async executeCsv(
    authUser: JwtPayload,
    branchId: string,
    query: SalesByHierarchyQuery,
  ): Promise<CsvDownload> {
    const scope = await this.scopeService.resolve(authUser, branchId, query, {
      forCsv: true,
      fullAccessOnly: true,
    });
    const response = await this.build(scope, query);

    async function* lines(): AsyncGenerator<CsvCell[]> {
      await Promise.resolve();

      for (const row of hierarchyToCsvRows(response)) {
        yield row;
      }
    }

    return {
      filename: `jerarquia-ventas_${branchId}_${scope.from}_${scope.to}.csv`,
      stream: csvStream(SALES_BY_HIERARCHY_CSV_HEADERS, lines()),
    };
  }

  private async build(
    scope: ReportScope,
    query: SalesByHierarchyQuery,
  ): Promise<SalesByHierarchyResponse> {
    const groupBy = query.groupBy ?? 'category';
    const includeModifiers = query.includeModifiers !== 'false';
    const parentPath =
      groupBy === 'category' && query.parentId
        ? decodeCategoryNodeId(query.parentId)
        : null;
    const records = await this.reportsRepository.findHierarchyLines({
      ...scope.filters,
      branchId: scope.branchId,
      start: scope.start,
      end: scope.end,
      timeZone: scope.timeZone,
      cashierId: scope.cashierId,
      methods: scope.methods,
      includeModifiers,
    });
    const view = buildHierarchyView(
      toHierarchyLines(records),
      groupBy,
      parentPath,
    );

    return {
      from: scope.from,
      to: scope.to,
      timeZone: scope.timeZone,
      parentId: parentPath ? (query.parentId ?? null) : null,
      breadcrumb: view.breadcrumb,
      groupBy,
      includeModifiers,
      nodes: view.nodes,
      totals: view.totals,
    };
  }
}
