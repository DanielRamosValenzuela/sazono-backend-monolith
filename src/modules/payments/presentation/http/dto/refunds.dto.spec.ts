import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRefundDto } from './refunds.dto';

const base = {
  amount: '3000',
  reasonCode: 'CUSTOMER_COMPLAINT',
  reasonText: 'Plato frio',
};

async function errorsFor(body: Record<string, unknown>) {
  const dto = plainToInstance(
    CreateRefundDto,
    { ...base, ...body },
    { enableImplicitConversion: true },
  );
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return { dto, fields: errors.map((error) => error.property) };
}

describe('CreateRefundDto', () => {
  it('accepts a minimal valid body', async () => {
    expect((await errorsFor({})).fields).toEqual([]);
  });

  it.each(['0', '1', '1500', '9999999999'])(
    'accepts amount %s',
    async (amount) => {
      expect((await errorsFor({ amount })).fields).toEqual([]);
    },
  );

  it.each([
    '',
    '-1',
    '01',
    '1.',
    '.5',
    '0.5',
    '1500.5',
    '1500.50',
    '100.55',
    '1.234',
    '1e3',
    '10000000000',
    'abc',
    '1 000',
  ])('rejects amount "%s"', async (amount) => {
    expect((await errorsFor({ amount })).fields).toContain('amount');
  });

  it('rejects an unknown reason code', async () => {
    expect((await errorsFor({ reasonCode: 'NOPE' })).fields).toContain(
      'reasonCode',
    );
  });

  it.each([
    '',
    'ab',
    '   ',
    ' a ',
    '\u200B\u200B\u200B',
    'ab\u200B',
    'ab\u0000c',
    'abc\u0007',
  ])('rejects reasonText "%s"', async (text) => {
    expect((await errorsFor({ reasonText: text })).fields).toContain(
      'reasonText',
    );
  });

  it('accepts a reason with accents and punctuation', async () => {
    expect(
      (await errorsFor({ reasonText: 'Plato frío, sin sal.' })).fields,
    ).toEqual([]);
  });

  it('trims reasonText and enforces the max length', async () => {
    const trimmed = await errorsFor({ reasonText: '  Plato frio  ' });
    expect(trimmed.dto.reasonText).toBe('Plato frio');
    expect(trimmed.fields).toEqual([]);

    expect((await errorsFor({ reasonText: 'x'.repeat(501) })).fields).toContain(
      'reasonText',
    );
  });

  it('validates tipAmount format and refundTip type', async () => {
    expect((await errorsFor({ tipAmount: '500' })).fields).toEqual([]);
    expect((await errorsFor({ tipAmount: '-5' })).fields).toContain(
      'tipAmount',
    );
    expect((await errorsFor({ refundTip: 'yes' })).fields).toContain(
      'refundTip',
    );
    expect((await errorsFor({ refundTip: true })).fields).toEqual([]);
  });

  it('requires approver id and PIN together', async () => {
    const id = '11111111-1111-4111-8111-111111111111';

    expect(
      (await errorsFor({ approverStaffUserId: id, approverPin: '1234' }))
        .fields,
    ).toEqual([]);
    expect((await errorsFor({ approverPin: '1234' })).fields).toContain(
      'approverStaffUserId',
    );
    expect((await errorsFor({ approverStaffUserId: id })).fields).toContain(
      'approverPin',
    );
  });

  it.each(['123', '1234567', 'abcd', '12 4'])(
    'rejects approverPin "%s"',
    async (pin) => {
      expect(
        (
          await errorsFor({
            approverStaffUserId: '11111111-1111-4111-8111-111111111111',
            approverPin: pin,
          })
        ).fields,
      ).toContain('approverPin');
    },
  );

  it('rejects unknown properties', async () => {
    expect((await errorsFor({ hacker: true })).fields).toContain('hacker');
  });
});
