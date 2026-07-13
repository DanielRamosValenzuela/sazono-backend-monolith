import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { RestaurantBySlugResponseDto } from '../presentation/http/dto/restaurant-by-slug.dto';

@Injectable()
export class GetRestaurantBySlugService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(slug: string): Promise<RestaurantBySlugResponseDto> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: {
        slug,
      },
      select: {
        name: true,
        status: true,
      },
    });

    if (!restaurant) {
      throw new NotFoundException('No existe un restaurante con esa URL.');
    }

    return {
      name: restaurant.name,
      isActive: restaurant.status === 'ACTIVE',
    };
  }
}
