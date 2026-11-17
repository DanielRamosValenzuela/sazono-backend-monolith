import { StreamableFile } from '@nestjs/common';
import { Readable } from 'node:stream';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import type { GetFilterOptionsService } from '../../application/get-filter-options.service';
import type { GetOrderDetailService } from '../../application/get-order-detail.service';
import type { GetPaymentsReportService } from '../../application/get-payments-report.service';
import type { GetSalesByHierarchyService } from '../../application/get-sales-by-hierarchy.service';
import type { GetSalesByOrderService } from '../../application/get-sales-by-order.service';
import { ReportsController } from './reports.controller';

const authUser = {
  sub: 'auth-1',
  profileType: LoginProfileType.STAFF,
  profileId: 'staff-1',
  restaurantId: 'restaurant-1',
};
const BRANCH = '11111111-1111-4111-8111-111111111111';
const BILL = '22222222-2222-4222-8222-222222222222';

describe('ReportsController', () => {
  const salesExecute = jest.fn();
  const salesCsv = jest.fn();
  const paymentsExecute = jest.fn();
  const hierarchyExecute = jest.fn();
  const detailExecute = jest.fn();
  const optionsExecute = jest.fn();
  const controller = new ReportsController(
    {
      execute: salesExecute,
      executeCsv: salesCsv,
    } as unknown as GetSalesByOrderService,
    { execute: paymentsExecute } as unknown as GetPaymentsReportService,
    { execute: hierarchyExecute } as unknown as GetSalesByHierarchyService,
    { execute: detailExecute } as unknown as GetOrderDetailService,
    { execute: optionsExecute } as unknown as GetFilterOptionsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates the order detail to its service with the branch and the bill', async () => {
    detailExecute.mockResolvedValue({ billId: BILL });

    await expect(
      controller.getOrderDetail(authUser, BRANCH, BILL),
    ).resolves.toEqual({ billId: BILL });
    expect(detailExecute).toHaveBeenCalledWith(authUser, BRANCH, BILL);
  });

  it('delegates the filter options to its service', async () => {
    optionsExecute.mockResolvedValue({ windowDays: 90 });

    await expect(
      controller.getFilterOptions(authUser, BRANCH),
    ).resolves.toEqual({ windowDays: 90 });
    expect(optionsExecute).toHaveBeenCalledWith(authUser, BRANCH);
  });

  it('passes every sales filter through to the JSON and the CSV report', async () => {
    const query = {
      from: '2026-07-14',
      to: '2026-07-15',
      waiterId: BILL,
      q: 'caro',
      orderBy: 'total' as const,
      direction: 'asc' as const,
    };

    salesExecute.mockResolvedValue({ rows: [] });
    salesCsv.mockResolvedValue({
      filename: 'x.csv',
      stream: Readable.from(['a']),
    });

    await controller.getSalesByOrder(authUser, BRANCH, query);
    const file = await controller.getSalesByOrder(authUser, BRANCH, {
      ...query,
      format: 'csv',
    });

    expect(salesExecute).toHaveBeenCalledWith(authUser, BRANCH, query);
    expect(salesCsv).toHaveBeenCalledWith(
      authUser,
      BRANCH,
      expect.objectContaining({ waiterId: BILL, q: 'caro', orderBy: 'total' }),
    );
    expect(file).toBeInstanceOf(StreamableFile);
  });
});
