import { RestaurantStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { SearchRestaurantsService } from './search-restaurants.service';

describe('SearchRestaurantsService', () => {
  const restaurantFindManyMock = jest.fn();
  const prisma = {
    restaurant: {
      findMany: restaurantFindManyMock,
    },
  } as unknown as PrismaService;

  let service: SearchRestaurantsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SearchRestaurantsService(prisma);
  });

  it('searches active restaurants by name prefix, limited to 5', async () => {
    restaurantFindManyMock.mockResolvedValue([
      { name: 'Sazono Bistro', slug: 'sazono-bistro' },
    ]);

    const result = await service.execute('sazono');

    expect(restaurantFindManyMock).toHaveBeenCalledWith({
      where: {
        status: RestaurantStatus.ACTIVE,
        name: {
          startsWith: 'sazono',
          mode: 'insensitive',
        },
      },
      select: {
        name: true,
        slug: true,
      },
      orderBy: {
        name: 'asc',
      },
      take: 5,
    });
    expect(result).toEqual([{ name: 'Sazono Bistro', slug: 'sazono-bistro' }]);
  });

  it('returns an empty array without querying for a query shorter than 2 characters', async () => {
    const result = await service.execute(' a ');

    expect(result).toEqual([]);
    expect(restaurantFindManyMock).not.toHaveBeenCalled();
  });
});
