import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { UpdateRestaurantService } from './update-restaurant.service';

describe('UpdateRestaurantService tax data', () => {
  const findUnique = jest.fn().mockResolvedValue({ id: 'r1' });
  const update = jest.fn().mockResolvedValue({
    id: 'r1',
    name: 'N',
    legalName: null,
    slug: 's',
    branchQuota: 1,
    status: 'ACTIVE',
    currency: 'CLP',
    timezone: 'America/Santiago',
    defaultLanguage: 'es',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    _count: { branches: 0, staffUsers: 0 },
  });
  const service = new UpdateRestaurantService({
    restaurant: { findUnique, update },
  } as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('normalises the RUT and trims the other tax fields', async () => {
    await service.execute('r1', {
      taxId: '123456785',
      businessActivity: '  Restaurantes ',
      legalAddress: 'Calle 1',
    });

    expect(update.mock.calls[0][0].data).toEqual({
      taxId: '12.345.678-5',
      businessActivity: 'Restaurantes',
      legalAddress: 'Calle 1',
    });
  });

  it('clears the values with null', async () => {
    await service.execute('r1', { taxId: null, legalAddress: '' });

    expect(update.mock.calls[0][0].data).toEqual({
      taxId: null,
      legalAddress: null,
    });
  });

  it('rejects an invalid RUT', async () => {
    await expect(
      service.execute('r1', { taxId: '12.345.678-9' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
});
