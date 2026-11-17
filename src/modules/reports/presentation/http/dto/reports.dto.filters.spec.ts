import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  PaymentsReportQueryDto,
  SalesByHierarchyQueryDto,
  SalesByOrderQueryDto,
} from './reports.dto';

const UUID = '11111111-1111-4111-8111-111111111111';

function errorsFor<T extends object>(
  type: new () => T,
  plain: Record<string, unknown>,
): string[] {
  return validateSync(
    plainToInstance(type, plain, { enableImplicitConversion: true }),
    { whitelist: true, forbidNonWhitelisted: true },
  ).map((error) => error.property);
}

describe('SalesByOrderQueryDto filters', () => {
  it('accepts every new filter at once', () => {
    expect(
      errorsFor(SalesByOrderQueryDto, {
        from: '2026-11-01',
        to: '2026-11-17',
        cashierId: UUID,
        waiterId: UUID,
        tableId: UUID,
        zoneId: UUID,
        status: 'PAID_FULL,MIXED',
        minTotal: '1000',
        maxTotal: '99000',
        hasTip: 'true',
        minTip: '500',
        source: 'WEB_QR,CASHIER,WAITER',
        timeFrom: '22:00',
        timeTo: '02:30',
        weekdays: '1,2,3,4,5,6,7',
        q: 'caro',
        productId: UUID,
        productName: 'Cafe Latte',
        categoryPath: 'Cafe > Bebidas Calientes',
        orderBy: 'orderNumber',
        direction: 'asc',
        cursor: 'abc',
        limit: '25',
        format: 'csv',
      }),
    ).toEqual([]);
  });

  it.each([
    [{ waiterId: 'x' }, 'waiterId'],
    [{ tableId: '123' }, 'tableId'],
    [{ zoneId: "' OR 1=1" }, 'zoneId'],
    [{ productId: 'nope' }, 'productId'],
    [{ status: 'paid' }, 'status'],
    [{ status: 'PAID;DROP' }, 'status'],
    [{ source: 'web qr' }, 'source'],
    [{ minTotal: -1 }, 'minTotal'],
    [{ minTotal: 1.5 }, 'minTotal'],
    [{ minTotal: 'abc' }, 'minTotal'],
    [{ maxTotal: 1_000_000_001 }, 'maxTotal'],
    [{ minTip: -1 }, 'minTip'],
    [{ hasTip: 'maybe' }, 'hasTip'],
    [{ timeFrom: '24:00' }, 'timeFrom'],
    [{ timeFrom: '9:00' }, 'timeFrom'],
    [{ timeTo: '12:60' }, 'timeTo'],
    [{ timeTo: '12:00:00' }, 'timeTo'],
    [{ weekdays: '0' }, 'weekdays'],
    [{ weekdays: '8' }, 'weekdays'],
    [{ weekdays: '1,,2' }, 'weekdays'],
    [{ weekdays: '1,2,3,4,5,6,7,1' }, 'weekdays'],
    [{ q: 'x'.repeat(201) }, 'q'],
    [{ q: ['a', 'b'] }, 'q'],
    [{ productName: 'x'.repeat(401) }, 'productName'],
    [{ categoryPath: 'x'.repeat(901) }, 'categoryPath'],
    [{ orderBy: 'eventAt' }, 'orderBy'],
    [{ orderBy: 'closedAt; DROP TABLE' }, 'orderBy'],
    [{ direction: 'up' }, 'direction'],
    [{ minAmount: 10 }, 'minAmount'],
    [{ paymentStatus: 'PAID' }, 'paymentStatus'],
  ])('rejects %j', (plain, property) => {
    expect(errorsFor(SalesByOrderQueryDto, plain)).toContain(property);
  });

  it('accepts the boundaries', () => {
    expect(
      errorsFor(SalesByOrderQueryDto, {
        minTotal: 0,
        maxTotal: 1_000_000_000,
        timeFrom: '00:00',
        timeTo: '23:59',
        weekdays: '7',
        q: 'x'.repeat(200),
      }),
    ).toEqual([]);
  });

  it('accepts LIKE wildcards and quotes in free text because they are escaped downstream', () => {
    expect(
      errorsFor(SalesByOrderQueryDto, {
        q: "100% _off_ 'x'; --",
        productName: '50%_%',
      }),
    ).toEqual([]);
  });
});

describe('PaymentsReportQueryDto filters', () => {
  it('accepts the applicable filters and the payments ordering', () => {
    expect(
      errorsFor(PaymentsReportQueryDto, {
        kind: 'payment',
        provider: 'MANUAL',
        paymentStatus: 'PAID',
        waiterId: UUID,
        cashierId: UUID,
        method: 'CASH',
        source: 'WEB_QR',
        minAmount: 100,
        maxAmount: 5000,
        hasTip: 'false',
        minTip: 0,
        timeFrom: '10:00',
        timeTo: '14:00',
        weekdays: '6,7',
        q: 'mp-123',
        orderBy: 'amount',
        direction: 'desc',
      }),
    ).toEqual([]);
  });

  it.each([
    [{ orderBy: 'closedAt' }, 'orderBy'],
    [{ orderBy: 'total' }, 'orderBy'],
    [{ minAmount: -5 }, 'minAmount'],
    [{ maxAmount: 'x' }, 'maxAmount'],
    [{ minTotal: 10 }, 'minTotal'],
    [{ status: 'MIXED' }, 'status'],
    [{ productName: 'x' }, 'productName'],
    [{ categoryPath: 'x' }, 'categoryPath'],
  ])('rejects %j', (plain, property) => {
    expect(errorsFor(PaymentsReportQueryDto, plain)).toContain(property);
  });
});

describe('SalesByHierarchyQueryDto filters', () => {
  it('accepts the bill level filters that make sense for the hierarchy', () => {
    expect(
      errorsFor(SalesByHierarchyQueryDto, {
        from: '2026-11-01',
        to: '2026-11-17',
        cashierId: UUID,
        waiterId: UUID,
        method: 'CASH,CREDIT_CARD',
        source: 'CASHIER',
        zoneId: UUID,
        tableId: UUID,
        timeFrom: '12:00',
        timeTo: '16:00',
        weekdays: '5,6,7',
        groupBy: 'item',
      }),
    ).toEqual([]);
  });

  it.each([
    [{ q: 'x' }, 'q'],
    [{ hasTip: 'true' }, 'hasTip'],
    [{ minTotal: 10 }, 'minTotal'],
    [{ orderBy: 'total' }, 'orderBy'],
    [{ status: 'MIXED' }, 'status'],
    [{ waiterId: 'x' }, 'waiterId'],
    [{ weekdays: '8' }, 'weekdays'],
    [{ timeTo: '99:99' }, 'timeTo'],
    [{ source: 'x y' }, 'source'],
  ])('rejects %j', (plain, property) => {
    expect(errorsFor(SalesByHierarchyQueryDto, plain)).toContain(property);
  });
});
