import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Role, MenuStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { hasPublishableContent } from './menu-category-tree';
import { collectModifierWarnings, mapMenuDetail } from './menu-mapper';
import { MODIFIER_GROUP_TREE_INCLUDE } from './modifier-group-include';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PublishMenuResponseDto } from '../presentation/http/dto/menus.dto';

@Injectable()
export class PublishMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    menuId: string,
  ): Promise<PublishMenuResponseDto> {
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

    await this.branchAccessService.ensureAccess(authUser, menu.branchId, [
      Role.ADMIN,
    ]);

    if (menu.status !== MenuStatus.DRAFT) {
      throw new ConflictException(
        'Solo se puede publicar una carta en estado DRAFT.',
      );
    }

    if (!hasPublishableContent(menu.categories)) {
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
                  media: {
                    orderBy: {
                      sortOrder: 'asc',
                    },
                  },
                  modifierGroups: {
                    orderBy: { sortOrder: 'asc' },
                    include: {
                      modifierGroup: { include: MODIFIER_GROUP_TREE_INCLUDE },
                    },
                  },
                },
              },
            },
          },
        },
      });
    });

    const warnings = collectModifierWarnings(
      publishedMenu.categories.flatMap((category) =>
        category.items.flatMap((item) =>
          item.modifierGroups.map((link) => link.modifierGroup),
        ),
      ),
    );

    return { ...mapMenuDetail(publishedMenu, true), warnings };
  }
}
