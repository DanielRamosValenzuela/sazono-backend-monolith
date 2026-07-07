import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { RestaurantSummaryResponseDto } from '../presentation/http/dto/list-restaurants.dto';
import type { UpdateRestaurantDto } from '../presentation/http/dto/update-restaurant.dto';

@Injectable()
export class UpdateRestaurantService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    restaurantId: string,
    dto: UpdateRestaurantDto,
  ): Promise<RestaurantSummaryResponseDto> {
    const data: Prisma.RestaurantUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = dto.name;
    }

    if (dto.legalName !== undefined) {
      data.legalName = dto.legalName;
    }

    if (dto.defaultLanguage !== undefined) {
      data.defaultLanguage = dto.defaultLanguage;
    }

    if (dto.timezone !== undefined) {
      data.timezone = dto.timezone;
    }

    if (dto.currency !== undefined) {
      data.currency = dto.currency;
    }

    if (dto.status !== undefined) {
      data.status = dto.status;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'Debes enviar al menos un campo para actualizar.',
      );
    }

    const restaurant = await this.prisma.restaurant.findUnique({
      where: {
        id: restaurantId,
      },
      select: {
        id: true,
      },
    });

    if (!restaurant) {
      throw new NotFoundException('El restaurante no existe.');
    }

    const updatedRestaurant = await this.prisma.restaurant.update({
      where: {
        id: restaurantId,
      },
      data,
      include: {
        _count: {
          select: {
            branches: true,
            staffUsers: true,
          },
        },
      },
    });

    return {
      restaurantId: updatedRestaurant.id,
      name: updatedRestaurant.name,
      legalName: updatedRestaurant.legalName,
      status: updatedRestaurant.status,
      currency: updatedRestaurant.currency,
      timezone: updatedRestaurant.timezone,
      defaultLanguage: updatedRestaurant.defaultLanguage,
      createdAt: updatedRestaurant.createdAt.toISOString(),
      branchCount: updatedRestaurant._count.branches,
      staffCount: updatedRestaurant._count.staffUsers,
    };
  }
}
