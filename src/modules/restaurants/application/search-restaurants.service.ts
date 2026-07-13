import { Injectable } from '@nestjs/common';
import { RestaurantStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { RestaurantSearchResultDto } from '../presentation/http/dto/search-restaurants.dto';

const MAX_RESULTS = 5;

@Injectable()
export class SearchRestaurantsService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: string): Promise<RestaurantSearchResultDto[]> {
    const normalizedQuery = query.trim();

    if (normalizedQuery.length < 2) {
      return [];
    }

    const restaurants = await this.prisma.restaurant.findMany({
      where: {
        status: RestaurantStatus.ACTIVE,
        name: {
          startsWith: normalizedQuery,
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
      take: MAX_RESULTS,
    });

    return restaurants;
  }
}
