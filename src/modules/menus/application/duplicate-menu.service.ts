import { BadRequestException, Injectable } from '@nestjs/common';
import { MenuStatus, Role, TranslationEntityType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type {
  DuplicateMenuDto,
  MenuDetailResponseDto,
} from '../presentation/http/dto/menus.dto';
import { GetMenuDetailService } from './get-menu-detail.service';

const NAME_MAX_LENGTH = 120;
const COPY_SUFFIX = ' (copia)';

@Injectable()
export class DuplicateMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
    private readonly getMenuDetailService: GetMenuDetailService,
  ) {}

  async execute(
    authUser: JwtPayload,
    menuId: string,
    dto: DuplicateMenuDto,
  ): Promise<MenuDetailResponseDto> {
    const source = await this.prisma.menu.findUnique({
      where: { id: menuId },
      include: {
        categories: {
          include: {
            items: {
              include: {
                media: true,
                modifierGroups: true,
              },
            },
          },
        },
      },
    });

    if (!source) {
      throw new BadRequestException('La carta indicada no existe.');
    }

    await this.branchAccessService.ensureAccess(authUser, source.branchId, [
      Role.ADMIN,
    ]);

    const categoryIds = new Map(
      source.categories.map((category) => [category.id, randomUUID()]),
    );
    const itemIds = new Map(
      source.categories.flatMap((category) =>
        category.items.map((item) => [item.id, randomUUID()] as const),
      ),
    );

    const translations = await this.prisma.translation.findMany({
      where: {
        OR: [
          {
            entityType: TranslationEntityType.MENU_CATEGORY,
            entityId: { in: [...categoryIds.keys()] },
          },
          {
            entityType: TranslationEntityType.MENU_ITEM,
            entityId: { in: [...itemIds.keys()] },
          },
        ],
      },
    });

    const name =
      dto.name?.trim() ||
      `${source.name.slice(0, NAME_MAX_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}`;

    const items = source.categories.flatMap((category) =>
      category.items.map((item) => ({ category, item })),
    );

    const newMenuId = await this.prisma.$transaction(async (tx) => {
      const latestMenu = await tx.menu.findFirst({
        where: { branchId: source.branchId },
        orderBy: { version: 'desc' },
      });

      const created = await tx.menu.create({
        data: {
          branchId: source.branchId,
          name,
          defaultLanguage: source.defaultLanguage,
          status: MenuStatus.DRAFT,
          version: (latestMenu?.version ?? 0) + 1,
        },
      });

      if (source.categories.length > 0) {
        await tx.menuCategory.createMany({
          data: source.categories.map((category) => ({
            id: categoryIds.get(category.id),
            menuId: created.id,
            name: category.name,
            sortOrder: category.sortOrder,
            status: category.status,
            parentId: category.parentId
              ? (categoryIds.get(category.parentId) ?? null)
              : null,
          })),
        });
      }

      if (items.length > 0) {
        await tx.menuItem.createMany({
          data: items.map(({ category, item }) => ({
            id: itemIds.get(item.id),
            menuCategoryId: categoryIds.get(category.id) as string,
            name: item.name,
            description: item.description,
            price: item.price,
            sku: item.sku,
            itemType: item.itemType,
            preparationStationId: item.preparationStationId,
            isAvailable: item.isAvailable,
            sortOrder: item.sortOrder,
          })),
        });
      }

      const media = items.flatMap(({ item }) =>
        item.media.map((row) => ({
          menuItemId: itemIds.get(item.id) as string,
          mediaType: row.mediaType,
          url: row.url,
          sortOrder: row.sortOrder,
        })),
      );

      if (media.length > 0) {
        await tx.menuItemMedia.createMany({ data: media });
      }

      const modifierLinks = items.flatMap(({ item }) =>
        item.modifierGroups.map((link) => ({
          menuItemId: itemIds.get(item.id) as string,
          modifierGroupId: link.modifierGroupId,
          sortOrder: link.sortOrder,
        })),
      );

      if (modifierLinks.length > 0) {
        await tx.menuItemModifierGroup.createMany({ data: modifierLinks });
      }

      if (translations.length > 0) {
        await tx.translation.createMany({
          data: translations.map((row) => ({
            entityType: row.entityType,
            entityId: (row.entityType === TranslationEntityType.MENU_CATEGORY
              ? categoryIds.get(row.entityId)
              : itemIds.get(row.entityId)) as string,
            locale: row.locale,
            fieldName: row.fieldName,
            translatedValue: row.translatedValue,
          })),
        });
      }

      return created.id;
    });

    return this.getMenuDetailService.execute(authUser, newMenuId);
  }
}
