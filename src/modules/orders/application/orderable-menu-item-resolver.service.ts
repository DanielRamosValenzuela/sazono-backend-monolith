import { BadRequestException, Injectable } from '@nestjs/common';
import {
  MenuCategoryStatus,
  MenuStatus,
  PreparationStationStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateOrderItemDto } from '../presentation/http/dto/orders.dto';

export type OrderableMenuItem = {
  menuItemId: string;
  name: string;
  price: Prisma.Decimal;
  preparationStationId: string;
  quantity: number;
  notes: string | null;
};

@Injectable()
export class OrderableMenuItemResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Valida que los items pedidos pertenezcan a la carta publicada activa de
   * la sucursal y retorna los datos necesarios para snapshotear la orden.
   */
  async resolve(
    branchId: string,
    itemDtos: CreateOrderItemDto[],
  ): Promise<OrderableMenuItem[]> {
    const branchSettings = await this.prisma.branchSettings.findUnique({
      where: {
        branchId,
      },
      include: {
        defaultMenu: true,
      },
    });

    const defaultMenu = branchSettings?.defaultMenu;

    if (!defaultMenu || defaultMenu.status !== MenuStatus.PUBLISHED) {
      throw new BadRequestException(
        'La sucursal no tiene una carta publicada disponible para ordenar.',
      );
    }

    const menuItemIds = [...new Set(itemDtos.map((item) => item.menuItemId))];

    const menuItems = await this.prisma.menuItem.findMany({
      where: {
        id: {
          in: menuItemIds,
        },
        menuCategory: {
          menuId: defaultMenu.id,
        },
      },
      include: {
        menuCategory: true,
        preparationStation: true,
      },
    });

    const menuItemsById = new Map(menuItems.map((item) => [item.id, item]));

    return itemDtos.map((itemDto) => {
      const menuItem = menuItemsById.get(itemDto.menuItemId);

      if (!menuItem) {
        throw new BadRequestException(
          'Uno de los items pedidos no pertenece a la carta publicada de la sucursal.',
        );
      }

      if (
        menuItem.menuCategory.status !== MenuCategoryStatus.ACTIVE ||
        !menuItem.isAvailable
      ) {
        throw new BadRequestException(
          `El item "${menuItem.name}" no esta disponible para ordenar.`,
        );
      }

      if (
        menuItem.preparationStation.status !== PreparationStationStatus.ACTIVE
      ) {
        throw new BadRequestException(
          `El item "${menuItem.name}" no tiene una estacion de preparacion activa.`,
        );
      }

      return {
        menuItemId: menuItem.id,
        name: menuItem.name,
        price: menuItem.price,
        preparationStationId: menuItem.preparationStationId,
        quantity: itemDto.quantity,
        notes: itemDto.notes?.trim() || null,
      };
    });
  }
}
