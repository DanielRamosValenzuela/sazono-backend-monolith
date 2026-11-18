import { BadRequestException, Injectable } from '@nestjs/common';
import {
  MenuCategoryStatus,
  MenuStatus,
  PreparationStationStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { categoryPathOf } from '../../menus/application/menu-category-tree';
import {
  resolveModifierSelection,
  type ModifierTreeGroup,
} from '../../menus/domain/modifier-tree';
import { MODIFIER_GROUP_TREE_INCLUDE } from '../../menus/application/modifier-group-include';
import type { CreateOrderItemDto } from '../presentation/http/dto/orders.dto';

export type OrderableModifier = {
  modifierOptionId: string;
  parentModifierOptionId: string | null;
  depth: number;
  path: string[];
  name: string;
  priceDelta: Prisma.Decimal;
};

export type OrderableMenuItem = {
  menuItemId: string;
  name: string;
  price: Prisma.Decimal;
  menuCategoryId: string;
  categoryPath: string[];
  preparationStationId: string;
  quantity: number;
  notes: string | null;
  modifiers: OrderableModifier[];
};

@Injectable()
export class OrderableMenuItemResolverService {
  constructor(private readonly prisma: PrismaService) {}
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
        menuCategory: {
          include: {
            parent: {
              include: {
                parent: true,
              },
            },
          },
        },
        preparationStation: true,
        modifierGroups: {
          include: {
            modifierGroup: {
              include: MODIFIER_GROUP_TREE_INCLUDE,
            },
          },
        },
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
        [
          menuItem.menuCategory.parent,
          menuItem.menuCategory.parent?.parent,
        ].some(
          (ancestor) =>
            ancestor && ancestor.status !== MenuCategoryStatus.ACTIVE,
        ) ||
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

      const modifiers = this.resolveModifiers(menuItem, itemDto);
      const modifiersDelta = modifiers.reduce(
        (total, modifier) => total.add(modifier.priceDelta),
        new Prisma.Decimal(0),
      );
      const unitPrice = menuItem.price.add(modifiersDelta);

      if (unitPrice.isNegative()) {
        throw new BadRequestException(
          `Los modificadores seleccionados dejan el precio de "${menuItem.name}" bajo cero.`,
        );
      }

      return {
        menuItemId: menuItem.id,
        name: menuItem.name,
        price: unitPrice,
        menuCategoryId: menuItem.menuCategoryId,
        categoryPath: categoryPathOf(menuItem.menuCategory),
        preparationStationId: menuItem.preparationStationId,
        quantity: itemDto.quantity,
        notes: itemDto.notes?.trim() || null,
        modifiers,
      };
    });
  }

  private resolveModifiers(
    menuItem: {
      name: string;
      modifierGroups: Array<{ modifierGroup: ModifierTreeGroup }>;
    },
    itemDto: CreateOrderItemDto,
  ): OrderableModifier[] {
    return resolveModifierSelection(
      menuItem.modifierGroups.map((link) => link.modifierGroup),
      itemDto.modifierOptionIds ?? [],
      menuItem.name,
    ).map(({ option, parentOptionId, depth, path }) => ({
      modifierOptionId: option.id,
      parentModifierOptionId: parentOptionId,
      depth,
      path,
      name: option.name,
      priceDelta: option.priceDelta,
    }));
  }
}
