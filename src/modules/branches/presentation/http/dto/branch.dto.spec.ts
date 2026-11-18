import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBranchDto } from './create-branch.dto';
import { UpdateBranchDto } from './branch.dto';

const fieldsOf = async <T extends object>(
  type: new () => T,
  body: Record<string, unknown>,
) => {
  const errors = await validate(
    plainToInstance(type, body, { enableImplicitConversion: true }),
    { whitelist: true, forbidNonWhitelisted: true },
  );

  return JSON.stringify(errors);
};

describe.each([
  ['UpdateBranchDto', UpdateBranchDto],
  ['CreateBranchDto', CreateBranchDto],
] as const)('%s refund settings', (_name, type) => {
  const body = (settings: Record<string, unknown>) => ({
    name: 'Sucursal',
    settings,
  });

  it('accepts a limit of zero, a positive limit and null', async () => {
    for (const cashierRefundLimit of [0, 20000, null]) {
      expect(
        await fieldsOf(type as new () => object, body({ cashierRefundLimit })),
      ).toBe('[]');
    }
  });

  it('rejects a negative or fractional limit', async () => {
    for (const cashierRefundLimit of [-1, 10.5, 10_000_000_000]) {
      expect(
        await fieldsOf(type as new () => object, body({ cashierRefundLimit })),
      ).toContain('cashierRefundLimit');
    }
  });

  it('accepts the tip default', async () => {
    expect(
      await fieldsOf(
        type as new () => object,
        body({ refundTipDefault: true }),
      ),
    ).toBe('[]');
  });
});
