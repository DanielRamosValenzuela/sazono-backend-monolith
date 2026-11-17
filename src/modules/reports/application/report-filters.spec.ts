import { BadRequestException } from '@nestjs/common';
import { escapeLike, parseReportFilters } from './report-filters';
import { EMPTY_FILTERS } from './report-types';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('parseReportFilters', () => {
  it('returns the empty filter set for an empty query', () => {
    expect(parseReportFilters({})).toEqual(EMPTY_FILTERS);
  });

  it('parses a full valid filter set', () => {
    expect(
      parseReportFilters({
        waiterId: UUID,
        tableId: UUID,
        zoneId: UUID,
        source: 'WEB_QR, CASHIER,WEB_QR',
        status: 'MIXED',
        minAmount: 1000,
        maxAmount: 90000,
        hasTip: 'true',
        minTip: 500,
        timeFrom: '09:30',
        timeTo: '23:59',
        weekdays: '7,1,1,3',
        q: '  Caro  ',
        productId: UUID,
        productName: ' Cafe Latte ',
        categoryPath: 'Cafe > Bebidas Calientes',
      }),
    ).toEqual({
      waiterId: UUID,
      tableId: UUID,
      zoneId: UUID,
      sources: ['WEB_QR', 'CASHIER'],
      billStatuses: ['MIXED'],
      minAmount: 1000,
      maxAmount: 90000,
      hasTip: true,
      minTip: 500,
      timeFromMinute: 570,
      timeToMinute: 1439,
      weekdays: [1, 3, 7],
      q: 'Caro',
      productId: UUID,
      productName: 'Cafe Latte',
      categoryPath: ['Cafe', 'Bebidas Calientes'],
    });
  });

  it('treats blank optional strings as absent', () => {
    expect(
      parseReportFilters({
        q: '   ',
        productName: '',
        categoryPath: ' ',
        waiterId: '',
        hasTip: '',
      }),
    ).toEqual(EMPTY_FILTERS);
  });

  it.each([
    ['waiterId', { waiterId: 'x' }],
    ['tableId', { tableId: UUID + '0' }],
    ['zoneId', { zoneId: "' OR 1=1 --" }],
    ['productId', { productId: '123' }],
    ['source', { source: 'POS' }],
    ['source mixed', { source: 'WEB_QR,POS' }],
    ['status', { status: 'PAID' }],
    ['minAmount negative', { minAmount: -1 }],
    ['minAmount decimal', { minAmount: 10.5 }],
    ['maxAmount too big', { maxAmount: 1_000_000_001 }],
    ['minAmount NaN', { minAmount: Number.NaN }],
    ['minTip negative', { minTip: -5 }],
    ['min above max', { minAmount: 5000, maxAmount: 4999 }],
    ['hasTip', { hasTip: 'yes' }],
    ['hasTip false with minTip', { hasTip: 'false', minTip: 100 }],
    ['timeFrom', { timeFrom: '24:00' }],
    ['timeFrom minutes', { timeFrom: '10:60' }],
    ['timeTo format', { timeTo: '9:30' }],
    ['timeTo injection', { timeTo: "10:00'; --" }],
    ['weekdays 0', { weekdays: '0' }],
    ['weekdays 8', { weekdays: '1,8' }],
    ['weekdays text', { weekdays: 'mon' }],
    ['q too long', { q: 'x'.repeat(101) }],
    ['productName too long', { productName: 'x'.repeat(201) }],
    ['categoryPath empty segment', { categoryPath: 'Cafe >> Bebidas' }],
    ['categoryPath too deep', { categoryPath: 'a>b>c>d>e' }],
    ['categoryPath segment too long', { categoryPath: 'x'.repeat(201) }],
  ])('rejects %s with 400', (_name, raw) => {
    expect(() => parseReportFilters(raw)).toThrow(BadRequestException);
  });

  it('accepts the boundaries', () => {
    const filters = parseReportFilters({
      minAmount: 0,
      maxAmount: 0,
      timeFrom: '00:00',
      timeTo: '00:00',
      weekdays: '1,2,3,4,5,6,7',
      q: 'x'.repeat(100),
      categoryPath: 'a>b>c>d',
      hasTip: 'false',
      minTip: 0,
    });

    expect(filters.minAmount).toBe(0);
    expect(filters.maxAmount).toBe(0);
    expect(filters.timeFromMinute).toBe(0);
    expect(filters.timeToMinute).toBe(0);
    expect(filters.weekdays).toHaveLength(7);
    expect(filters.categoryPath).toHaveLength(4);
    expect(filters.hasTip).toBe(false);
  });

  it('keeps hostile free text untouched so it can only travel as a bound parameter', () => {
    const hostile = "'; DROP TABLE bills; --";

    expect(parseReportFilters({ q: hostile }).q).toBe(hostile);
    expect(parseReportFilters({ productName: hostile }).productName).toBe(
      hostile,
    );
  });
});

describe('escapeLike', () => {
  it.each([
    ['100%', '100!%'],
    ['a_b', 'a!_b'],
    ['wow!', 'wow!!'],
    ['%_!', '!%!_!!'],
    ['back\\slash', 'back\\slash'],
    ['plain', 'plain'],
  ])('escapes %s as %s', (input, expected) => {
    expect(escapeLike(input)).toBe(expected);
  });
});
