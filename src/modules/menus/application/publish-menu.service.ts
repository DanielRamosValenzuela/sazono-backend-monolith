import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { MenuCategoryStatus, MenuStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { mapMenuDetail } from './menu-mapper';
import { MenusBranchAdminAccessService } from './menus-branch-admin-access.service';
import type { MenuDetailResponseDto } from '../presentation/http/dto/menus.dto';

@Injectable()
export class PublishMenuService {
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
              orderBy: [{ name: 'asc' }],
              include: {
                preparationStation: true,
              },
            },
          },
        },
      },
    });

    if (!menu) {
      throw new BadRequestException('La carta indicada no existe.');
    }

    await this.menusBranchAdminAccessService.ensureAdminAccess(
      authUser,
      menu.branchId,
    );

    if (menu.status !== MenuStatus.DRAFT) {
      throw new ConflictException(
        'Solo se puede publicar una carta en estado DRAFT.',
      );
    }

    const hasPublishableContent = menu.categories.some(
      (category) =>
        category.status === MenuCategoryStatus.ACTIVE &&
        category.items.length > 0,
    );

    if (!hasPublishableContent) {
      throw new BadRequestException(
        'La carta debe tener al menos una categoria activa con items para publicarse.',
      );
    }

    const publishedAt = new Date();

    const publishedMenu = await this.prisma.$transaction(async (tx) => {
      await tx.menu.updateMany({
        where: {
          branchId: menu.branchId,
          status: MenuStatus.PUBLISHED,
          id: {
            not: menu.id,
          },
        },
        data: {
          status: MenuStatus.ARCHIVED,
        },
      });

      await tx.menu.update({
        where: {
          id: menu.id,
        },
        data: {
          status: MenuStatus.PUBLISHED,
          publishedAt,
        },
      });

      await tx.branchSettings.update({
        where: {
          branchId: menu.branchId,
        },
        data: {
          defaultMenuId: menu.id,
        },
      });

      return tx.menu.findUniqueOrThrow({
        where: {
          id: menu.id,
        },
        include: {
          categories: {
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            include: {
              items: {
                orderBy: [{ name: 'asc' }],
                include: {
                  preparationStation: true,
                },
              },
            },
          },
        },
      });
    });

    return mapMenuDetail(publishedMenu, true);
  }
}
