import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  PaymentsReportQueryDto,
  ReportRangeQueryDto,
  SalesByHierarchyQueryDto,
} from './reports.dto';

function errorsFor<T extends object>(
  type: new () => T,
  plain: Record<string, unknown>,
): string[] {
  return validateSync(
    plainToInstance(type, plain, { enableImplicitConversion: true }),
    { whitelist: true, forbidNonWhitelisted: true },
  ).map((error) => error.property);
}

describe('SalesByHierarchyQueryDto', () => {
  it('accepts the full set of parameters', () => {
    expect(
      errorsFor(SalesByHierarchyQueryDto, {
        from: '2026-11-01',
        to: '2026-11-17',
        parentId: 'eyJrIjoiYyIsInAiOlsiQ2FmZSJdfQ',
        groupBy: 'item',
        includeModifiers: 'false',
        format: 'csv',
      }),
    ).toEqual([]);
  });

  it.each([
    [{ groupBy: 'method' }, 'groupBy'],
    [{ includeModifiers: 'yes' }, 'includeModifiers'],
    [{ format: 'xlsx' }, 'format'],
    [{ from: '2026-1-1' }, 'from'],
    [{ parentId: 'x'.repeat(2049) }, 'parentId'],
    [{ cashierId: 'a' }, 'cashierId'],
  ])('rejects %j', (plain, property) => {
    expect(errorsFor(SalesByHierarchyQueryDto, plain)).toContain(property);
  });
});

describe('report query DTOs', () => {
  it('accepts a minimal valid range', () => {
    expect(
      errorsFor(ReportRangeQueryDto, { from: '2026-11-01', to: '2026-11-17' }),
    ).toEqual([]);
  });

  it.each([
    [{ from: '01-11-2026' }, 'from'],
    [{ to: '2026/11/17' }, 'to'],
    [{ limit: 201 }, 'limit'],
    [{ limit: 0 }, 'limit'],
    [{ format: 'xlsx' }, 'format'],
    [{ cashierId: 'not-a-uuid' }, 'cashierId'],
    [{ method: 'cash' }, 'method'],
    [{ unknown: 'x' }, 'unknown'],
  ])('rejects %j', (plain, property) => {
    expect(errorsFor(ReportRangeQueryDto, plain)).toContain(property);
  });

  it('validates the payments report extras', () => {
    expect(
      errorsFor(PaymentsReportQueryDto, {
        kind: 'attempt',
        provider: 'TRANSBANK',
        paymentStatus: 'FAILED',
        format: 'csv',
      }),
    ).toEqual([]);
    expect(errorsFor(PaymentsReportQueryDto, { kind: 'other' })).toContain(
      'kind',
    );
    expect(
      errorsFor(PaymentsReportQueryDto, { paymentStatus: 'WHATEVER' }),
    ).toContain('paymentStatus');
  });
});
