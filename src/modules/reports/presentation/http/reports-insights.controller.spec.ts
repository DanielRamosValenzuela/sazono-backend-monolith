import 'reflect-metadata';
import { StreamableFile } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Readable } from 'node:stream';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import type { GetOpenTabsService } from '../../application/get-open-tabs.service';
import type { GetSalesByMethodService } from '../../application/get-sales-by-method.service';
import type { GetSalesByStaffService } from '../../application/get-sales-by-staff.service';
import type { GetSalesByTimeService } from '../../application/get-sales-by-time.service';
import type { GetSummaryKpisService } from '../../application/get-summary-kpis.service';
import type { GetTipsReportService } from '../../application/get-tips-report.service';
import {
  InsightsQueryDto,
  OpenTabsQueryDto,
  SalesByStaffQueryDto,
  SalesByTimeQueryDto,
  SummaryKpisQueryDto,
} from './dto/reports-insights.dto';
import { ReportsInsightsController } from './reports-insights.controller';

const authUser = {
  sub: 'auth-1',
  profileType: LoginProfileType.STAFF,
  profileId: 'staff-1',
  restaurantId: 'restaurant-1',
};
const BRANCH = '11111111-1111-4111-8111-111111111111';

function errorsFor<T extends object>(
  type: new () => T,
  plain: Record<string, unknown>,
): string[] {
  return validateSync(
    plainToInstance(type, plain, { enableImplicitConversion: true }),
    { whitelist: true, forbidNonWhitelisted: true },
  ).map((error) => error.property);
}

describe('ReportsInsightsController', () => {
  const services = {
    method: { execute: jest.fn(), executeCsv: jest.fn() },
    staff: { execute: jest.fn(), executeCsv: jest.fn() },
    time: { execute: jest.fn(), executeCsv: jest.fn() },
    tips: { execute: jest.fn(), executeCsv: jest.fn() },
    tabs: { execute: jest.fn(), executeCsv: jest.fn() },
    kpis: { execute: jest.fn(), executeCsv: jest.fn() },
  };
  const controller = new ReportsInsightsController(
    services.method as unknown as GetSalesByMethodService,
    services.staff as unknown as GetSalesByStaffService,
    services.time as unknown as GetSalesByTimeService,
    services.tips as unknown as GetTipsReportService,
    services.tabs as unknown as GetOpenTabsService,
    services.kpis as unknown as GetSummaryKpisService,
  );
  const calls: [
    string,
    keyof typeof services,
    (query: never) => Promise<unknown>,
  ][] = [
    [
      'sales-by-method',
      'method',
      (query) => controller.getSalesByMethod(authUser, BRANCH, query),
    ],
    [
      'sales-by-staff',
      'staff',
      (query) => controller.getSalesByStaff(authUser, BRANCH, query),
    ],
    [
      'sales-by-time',
      'time',
      (query) => controller.getSalesByTime(authUser, BRANCH, query),
    ],
    ['tips', 'tips', (query) => controller.getTips(authUser, BRANCH, query)],
    [
      'open-tabs',
      'tabs',
      (query) => controller.getOpenTabs(authUser, BRANCH, query),
    ],
    [
      'summary-kpis',
      'kpis',
      (query) => controller.getSummaryKpis(authUser, BRANCH, query),
    ],
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(calls)(
    '%s returns JSON by default and a CSV file with format=csv',
    async (_name, key, run) => {
      const query = { from: '2026-07-14', to: '2026-07-15' } as never;

      services[key].execute.mockResolvedValue({ rows: [] });
      services[key].executeCsv.mockResolvedValue({
        filename: 'x.csv',
        stream: Readable.from(['a']),
      });

      await expect(run(query)).resolves.toEqual({ rows: [] });
      expect(services[key].execute).toHaveBeenCalledWith(
        authUser,
        BRANCH,
        query,
      );

      const file = await run({ ...(query as object), format: 'csv' } as never);

      expect(file).toBeInstanceOf(StreamableFile);
      expect(services[key].executeCsv).toHaveBeenCalledTimes(1);
    },
  );

  describe('query DTOs', () => {
    it('accept the sales filter family and the endpoint specific parameters', () => {
      const filters = {
        from: '2026-07-01',
        to: '2026-07-15',
        cashierId: BRANCH,
        method: 'CASH,CREDIT_CARD',
        waiterId: BRANCH,
        timeFrom: '10:00',
        weekdays: '1,2',
        hasTip: 'true',
        minTotal: '1000',
        format: 'csv',
      };

      expect(errorsFor(InsightsQueryDto, filters)).toEqual([]);
      expect(
        errorsFor(SalesByStaffQueryDto, { ...filters, role: 'cashier' }),
      ).toEqual([]);
      expect(
        errorsFor(SalesByTimeQueryDto, { ...filters, bucket: 'month' }),
      ).toEqual([]);
      expect(
        errorsFor(SummaryKpisQueryDto, { ...filters, compare: 'previous' }),
      ).toEqual([]);
      expect(
        errorsFor(OpenTabsQueryDto, {
          kind: 'cancelled',
          from: '2026-07-01',
          to: '2026-07-02',
          tableId: BRANCH,
          zoneId: BRANCH,
        }),
      ).toEqual([]);
    });

    it.each([
      [SalesByStaffQueryDto, { role: 'owner' }, 'role'],
      [SalesByTimeQueryDto, { bucket: 'year' }, 'bucket'],
      [SummaryKpisQueryDto, { compare: 'next' }, 'compare'],
      [OpenTabsQueryDto, { kind: 'closed' }, 'kind'],
      [OpenTabsQueryDto, { format: 'xlsx' }, 'format'],
      [InsightsQueryDto, { orderBy: 'total' }, 'orderBy'],
      [InsightsQueryDto, { cursor: 'abc' }, 'cursor'],
      [InsightsQueryDto, { limit: 5 }, 'limit'],
      [OpenTabsQueryDto, { cashierId: BRANCH }, 'cashierId'],
    ] as const)('reject %j', (type, plain, property) => {
      expect(errorsFor(type as new () => object, plain)).toContain(property);
    });
  });
});
