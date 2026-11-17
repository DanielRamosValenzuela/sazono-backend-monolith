import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  ReportsPrismaRepository,
  type FilterOptionsRecord,
} from '../infrastructure/reports.prisma.repository';
import { UNCATEGORIZED_LABEL } from './hierarchy-tree';
import { ReportScopeService } from './report-scope.service';
import {
  FILTER_OPTIONS_WINDOW_DAYS,
  METHOD_KEYS,
  METHOD_LABELS,
  UNCLASSIFIED_METHOD,
  type MethodKey,
} from './report-types';

const OPTIONS_LIMIT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const PATH_SEPARATOR = ' > ';

export type FilterOptionsResponse = {
  windowDays: number;
  since: string;
  staff: {
    id: string;
    name: string | null;
    roles: string[];
    active: boolean;
    hasPayments: boolean;
  }[];
  zones: { id: string; name: string }[];
  tables: {
    id: string;
    name: string;
    code: string;
    zoneId: string | null;
    isVirtual: boolean;
  }[];
  paymentMethods: { method: MethodKey; label: string }[];
  providers: string[];
  sources: string[];
  categories: {
    path: string[];
    label: string;
    level: number;
    quantity: number;
  }[];
  products: {
    id: string | null;
    name: string;
    categoryPath: string[];
    categoryLabel: string;
    quantity: number;
  }[];
};

function normalizePath(path: string[] | null): string[] {
  return path && path.length > 0 ? path : [UNCATEGORIZED_LABEL];
}

function buildCategories(
  rows: FilterOptionsRecord['categories'],
): FilterOptionsResponse['categories'] {
  const byLabel = new Map<
    string,
    FilterOptionsResponse['categories'][number]
  >();

  for (const row of rows) {
    const path = normalizePath(row.path);

    for (let depth = 1; depth <= path.length; depth += 1) {
      const prefix = path.slice(0, depth);
      const label = prefix.join(PATH_SEPARATOR);
      const current = byLabel.get(label);

      if (current) {
        current.quantity += row.quantity;
      } else {
        byLabel.set(label, {
          path: prefix,
          label,
          level: depth,
          quantity: row.quantity,
        });
      }
    }
  }

  return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function buildFilterOptions(
  record: FilterOptionsRecord,
  since: Date,
): FilterOptionsResponse {
  const usedMethods = new Set(record.payments?.methods ?? []);

  if (record.payments?.has_unclassified) {
    usedMethods.add(UNCLASSIFIED_METHOD);
  }

  return {
    windowDays: FILTER_OPTIONS_WINDOW_DAYS,
    since: since.toISOString(),
    staff: record.staff.map((staff) => ({
      id: staff.id,
      name: staff.name,
      roles: staff.roles,
      active: staff.status === 'ACTIVE' && staff.roles.length > 0,
      hasPayments: staff.has_payments,
    })),
    zones: record.zones,
    tables: record.tables.map((table) => ({
      id: table.id,
      name: table.name,
      code: table.code,
      zoneId: table.zone_id,
      isVirtual: table.is_virtual,
    })),
    paymentMethods: METHOD_KEYS.filter((method) => usedMethods.has(method)).map(
      (method) => ({ method, label: METHOD_LABELS[method] }),
    ),
    providers: record.payments?.providers ?? [],
    sources: record.payments?.sources ?? [],
    categories: buildCategories(record.categories),
    products: record.products.map((product) => {
      const path = normalizePath(product.path);

      return {
        id: product.id,
        name: product.name,
        categoryPath: path,
        categoryLabel: path.join(PATH_SEPARATOR),
        quantity: product.quantity,
      };
    }),
  };
}

@Injectable()
export class GetFilterOptionsService {
  constructor(
    private readonly scopeService: ReportScopeService,
    private readonly reportsRepository: ReportsPrismaRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
  ): Promise<FilterOptionsResponse> {
    const access = await this.scopeService.resolveAccess(authUser, branchId);
    const since = new Date(Date.now() - FILTER_OPTIONS_WINDOW_DAYS * DAY_MS);
    const record = await this.reportsRepository.findFilterOptions(
      branchId,
      since,
      access.cashierScoped ? access.staffUserId : null,
      OPTIONS_LIMIT,
    );

    return buildFilterOptions(record, since);
  }
}
