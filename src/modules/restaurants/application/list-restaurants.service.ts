import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { RestaurantSummaryResponseDto } from '../presentation/http/dto/list-restaurants.dto';

@Injectable()
export class ListRestaurantsService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<RestaurantSummaryResponseDto[]> {
    const restaurants = await this.prisma.restaurant.findMany({
      include: {
        _count: {
          select: {
            branches: true,
            staffUsers: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return restaurants.map((restaurant) => ({
      restaurantId: restaurant.id,
      name: restaurant.name,
      legalName: restaurant.legalName,
      slug: restaurant.slug,
      branchQuota: restaurant.branchQuota,
      status: restaurant.status,
      currency: restaurant.currency,
      timezone: restaurant.timezone,
      defaultLanguage: restaurant.defaultLanguage,
      createdAt: restaurant.createdAt.toISOString(),
      branchCount: restaurant._count.branches,
      staffCount: restaurant._count.staffUsers,
    }));
  }
}
