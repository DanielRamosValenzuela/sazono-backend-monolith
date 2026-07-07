import { Injectable } from '@nestjs/common';
import { MenuStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { mapMenuListItem } from './menu-mapper';
import { MenusBranchAdminAccessService } from './menus-branch-admin-access.service';
import type {
  CreateMenuDto,
  MenuListItemResponseDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class CreateMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly menusBranchAdminAccessService: MenusBranchAdminAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    dto: CreateMenuDto,
  ): Promise<MenuListItemResponseDto> {
    await this.menusBranchAdminAccessService.ensureAdminAccess(
      authUser,
      dto.branchId,
    );

    const createdMenu = await this.prisma.$transaction(async (tx) => {
      const latestMenu = await tx.menu.findFirst({
        where: {
          branchId: dto.branchId,
        },
        orderBy: {
          version: 'desc',
        },
      });

      return tx.menu.create({
        data: {
          branchId: dto.branchId,
          name: dto.name.trim(),
          defaultLanguage: dto.defaultLanguage.trim().toLowerCase(),
          status: MenuStatus.DRAFT,
          version: (latestMenu?.version ?? 0) + 1,
        },
        include: {
          categories: {
            include: {
              items: true,
            },
          },
        },
      });
    });

    return mapMenuListItem(createdMenu, false);
  }
}
