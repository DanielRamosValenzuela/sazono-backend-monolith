import { BadRequestException, Injectable } from '@nestjs/common';
import {
  MenuCategoryStatus,
  MenuStatus,
  PreparationStationStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateOrderItemDto } from '../presentation/http/dto/orders.dto';

export type OrderableModifier = {
  modifierOptionId: string;
  name: string;
  priceDelta: Prisma.Decimal;
};

export type OrderableMenuItem = {
  menuItemId: string;
  name: string;
  price: Prisma.Decimal;
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
        menuCategory: true,
        preparationStation: true,
        modifierGroups: {
          include: {
            modifierGroup: {
              include: {
                options: true,
              },
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

      return {
        menuItemId: menuItem.id,
        name: menuItem.name,
        price: menuItem.price.add(modifiersDelta),
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
      modifierGroups: Array<{
        modifierGroup: {
          id: string;
          name: string;
          minSelect: number;
          maxSelect: number | null;
          isRequired: boolean;
          options: Array<{
            id: string;
            name: string;
            priceDelta: Prisma.Decimal;
            isAvailable: boolean;
          }>;
        };
      }>;
    },
    itemDto: CreateOrderItemDto,
  ): OrderableModifier[] {
    const selectedOptionIds = itemDto.modifierOptionIds ?? [];

    const optionToGroup = new Map<
      string,
      {
        group: (typeof menuItem.modifierGroups)[number]['modifierGroup'];
        option: (typeof menuItem.modifierGroups)[number]['modifierGroup']['options'][number];
      }
    >();

    for (const link of menuItem.modifierGroups) {
      for (const option of link.modifierGroup.options) {
        optionToGroup.set(option.id, { group: link.modifierGroup, option });
      }
    }

    const selectedByGroupId = new Map<string, OrderableModifier[]>();

    for (const optionId of selectedOptionIds) {
      const resolved = optionToGroup.get(optionId);

      if (!resolved) {
        throw new BadRequestException(
          `Uno de los modificadores seleccionados no pertenece al item "${menuItem.name}".`,
        );
      }

      if (!resolved.option.isAvailable) {
        throw new BadRequestException(
          `El modificador "${resolved.option.name}" no esta disponible.`,
        );
      }

      const groupSelections = selectedByGroupId.get(resolved.group.id) ?? [];
      groupSelections.push({
        modifierOptionId: resolved.option.id,
        name: resolved.option.name,
        priceDelta: resolved.option.priceDelta,
      });
      selectedByGroupId.set(resolved.group.id, groupSelections);
    }

    for (const link of menuItem.modifierGroups) {
      const group = link.modifierGroup;
      const selectedCount = selectedByGroupId.get(group.id)?.length ?? 0;
      const effectiveMin = group.isRequired
        ? Math.max(group.minSelect, 1)
        : group.minSelect;

      if (selectedCount < effectiveMin) {
        throw new BadRequestException(
          `Debes seleccionar al menos ${effectiveMin} opcion(es) de "${group.name}" para "${menuItem.name}".`,
        );
      }

      if (group.maxSelect !== null && selectedCount > group.maxSelect) {
        throw new BadRequestException(
          `Puedes seleccionar como maximo ${group.maxSelect} opcion(es) de "${group.name}" para "${menuItem.name}".`,
        );
      }
    }

    return [...selectedByGroupId.values()].flat();
  }
}
