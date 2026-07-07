import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { mapMenuListItem } from './menu-mapper';
import { MenusBranchAdminAccessService } from './menus-branch-admin-access.service';
import type {
  ListMenusQueryDto,
  MenuListItemResponseDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class ListMenusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly menusBranchAdminAccessService: MenusBranchAdminAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    query: ListMenusQueryDto,
  ): Promise<MenuListItemResponseDto[]> {
    await this.menusBranchAdminAccessService.ensureAdminAccess(
      authUser,
      query.branchId,
    );

    const [branchSettings, menus] = await Promise.all([
      this.prisma.branchSettings.findUnique({
        where: {
          branchId: query.branchId,
        },
      }),
      this.prisma.menu.findMany({
        where: {
          branchId: query.branchId,
        },
        include: {
          categories: {
            include: {
              items: true,
            },
          },
        },
        orderBy: [{ version: 'desc' }],
      }),
    ]);

    return menus.map((menu) =>
      mapMenuListItem(menu, branchSettings?.defaultMenuId === menu.id),
    );
  }
}
