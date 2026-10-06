import { Prisma, TableStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { EnsureCounterTableService } from './ensure-counter-table.service';

describe('EnsureCounterTableService', () => {
  const findFirst = jest.fn();
  const create = jest.fn();
  const service = new EnsureCounterTableService({
    table: { findFirst, create },
  } as unknown as PrismaService);

  beforeEach(() => jest.resetAllMocks());

  it('returns the existing virtual table without creating', async () => {
    findFirst.mockResolvedValue({ id: 't1' });
    await expect(service.execute('b1')).resolves.toEqual({ id: 't1' });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a DISABLED virtual table when missing', async () => {
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue({ id: 't1' });
    await service.execute('b1');
    const arg = create.mock.calls[0][0] as {
      data: { isVirtual: boolean; status: TableStatus; code: string };
    };
    expect(arg.data).toMatchObject({
      isVirtual: true,
      status: TableStatus.DISABLED,
      code: 'MOSTRADOR',
    });
  });

  it('re-selects on P2002 race', async () => {
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 't2' });
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(service.execute('b1')).resolves.toEqual({ id: 't2' });
  });
});
