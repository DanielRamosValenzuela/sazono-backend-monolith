import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RefundsReportQueryDto } from './reports.dto';

async function fieldsOf(query: Record<string, unknown>) {
  const errors = await validate(
    plainToInstance(RefundsReportQueryDto, query, {
      enableImplicitConversion: true,
    }),
    { whitelist: true, forbidNonWhitelisted: true },
  );

  return errors.map((error) => error.property);
}

describe('RefundsReportQueryDto', () => {
  it('accepts every refund filter', async () => {
    expect(
      await fieldsOf({
        from: '2026-07-01',
        to: '2026-07-10',
        requestedById: '22222222-2222-4222-8222-222222222222',
        reasonCode: 'OTHER,WRONG_ORDER',
        refundStatus: 'SUCCEEDED',
        refundMethod: 'CASH_MANUAL',
        method: 'CASH',
        cashierId: '22222222-2222-4222-8222-222222222222',
        minAmount: 100,
        maxAmount: 5000,
        hasTip: 'true',
        minTip: 50,
        q: 'plato',
        orderBy: 'amount',
        direction: 'asc',
        limit: 20,
        format: 'csv',
      }),
    ).toEqual([]);
  });

  it.each([
    ['requestedById', 'not-a-uuid'],
    ['reasonCode', 'other'],
    ['reasonCode', 'OTHER;DROP'],
    ['refundStatus', '1,2'],
    ['refundMethod', 'cash'],
    ['minAmount', -1],
    ['maxAmount', 1.5],
    ['orderBy', 'tip'],
    ['direction', 'up'],
    ['format', 'pdf'],
  ])('rejects %s = %j', async (field, value) => {
    expect(await fieldsOf({ [field]: value })).toContain(field);
  });

  it('rejects unknown properties', async () => {
    expect(await fieldsOf({ wat: 1 })).toContain('wat');
  });
});
