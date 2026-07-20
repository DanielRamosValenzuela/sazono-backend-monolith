import { Injectable, NotFoundException } from '@nestjs/common';
import {
  MenuCategoryStatus,
  MenuStatus,
  TableStatus,
  TranslationEntityType,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { groupTranslationsByEntity, mapMenuDetail } from './menu-mapper';
import type { MenuDetailResponseDto } from '../presentation/http/dto/menus.dto';

@Injectable()
export class GetPublishedMenuByQrService {
  constructor(private readonly prisma: PrismaService) {}
  async execute(
    qrToken: string,
    locale?: string,
  ): Promise<MenuDetailResponseDto> {
    const table = await this.prisma.table.findUnique({
      where: {
        qrToken,
      },
      include: {
        branch: {
          include: {
            settings: {
              include: {
                defaultMenu: true,
              },
            },
          },
        },
      },
    });

    if (!table || table.status === TableStatus.DISABLED) {
      throw new NotFoundException('El QR indicado no esta disponible.');
    }

    const defaultMenu = table.branch.settings?.defaultMenu;

    if (!defaultMenu || defaultMenu.status !== MenuStatus.PUBLISHED) {
      throw new NotFoundException(
        'La sucursal no tiene una carta publicada disponible.',
      );
    }

    const menu = await this.prisma.menu.findUniqueOrThrow({
      where: {
        id: defaultMenu.id,
      },
      include: {
        categories: {
          where: {
            status: MenuCategoryStatus.ACTIVE,
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            items: {
              where: {
                isAvailable: true,
              },
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
              include: {
                preparationStation: true,
                media: {
                  orderBy: { sortOrder: 'asc' },
                },
                modifierGroups: {
                  orderBy: { sortOrder: 'asc' },
                  include: {
                    modifierGroup: {
                      include: {
                        options: {
                          orderBy: { sortOrder: 'asc' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!locale || locale === menu.defaultLanguage) {
      return mapMenuDetail(menu, true);
    }

    const categoryIds = menu.categories.map((category) => category.id);
    const itemIds = menu.categories.flatMap((category) =>
      category.items.map((item) => item.id),
    );

    const translations = await this.prisma.translation.findMany({
      where: {
        locale,
        OR: [
          {
            entityType: TranslationEntityType.MENU_CATEGORY,
            entityId: { in: categoryIds },
          },
          {
            entityType: TranslationEntityType.MENU_ITEM,
            entityId: { in: itemIds },
          },
        ],
      },
    });

    const translationsByEntity = groupTranslationsByEntity(translations);
    const detail = mapMenuDetail(menu, true, translationsByEntity);

    return {
      ...detail,
      categories: detail.categories.map((category) => {
        const categoryTranslation = translationsByEntity
          .get(category.menuCategoryId)
          ?.find((entry) => entry.locale === locale);

        return {
          ...category,
          name: categoryTranslation?.name || category.name,
          translations: [],
          items: category.items.map((item) => {
            const itemTranslation = translationsByEntity
              .get(item.menuItemId)
              ?.find((entry) => entry.locale === locale);

            return {
              ...item,
              name: itemTranslation?.name || item.name,
              description: itemTranslation?.description || item.description,
              translations: [],
            };
          }),
        };
      }),
    };
  }
}
