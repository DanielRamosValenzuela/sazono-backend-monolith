import { BadRequestException, Injectable } from '@nestjs/common';
import { TranslationEntityType } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { groupTranslationsByEntity, mapMenuDetail } from './menu-mapper';
import { MenusBranchAdminAccessService } from './menus-branch-admin-access.service';
import type { MenuDetailResponseDto } from '../presentation/http/dto/menus.dto';

@Injectable()
export class GetMenuDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly menusBranchAdminAccessService: MenusBranchAdminAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    menuId: string,
  ): Promise<MenuDetailResponseDto> {
    const menu = await this.prisma.menu.findUnique({
      where: {
        id: menuId,
      },
      include: {
        categories: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            items: {
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
              include: {
                preparationStation: true,
                media: {
                  orderBy: { sortOrder: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!menu) {
      throw new BadRequestException('La carta indicada no existe.');
    }

    const branchSettings = await this.prisma.branchSettings.findUniqueOrThrow({
      where: {
        branchId: menu.branchId,
      },
    });

    await this.menusBranchAdminAccessService.ensureAdminAccess(
      authUser,
      menu.branchId,
    );

    const categoryIds = menu.categories.map((category) => category.id);
    const itemIds = menu.categories.flatMap((category) =>
      category.items.map((item) => item.id),
    );

    const translations = await this.prisma.translation.findMany({
      where: {
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

    return mapMenuDetail(
      menu,
      branchSettings.defaultMenuId === menu.id,
      groupTranslationsByEntity(translations),
    );
  }
}
