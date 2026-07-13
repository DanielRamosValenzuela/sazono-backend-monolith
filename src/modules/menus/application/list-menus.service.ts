import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { mapMenuListItem } from './menu-mapper';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type {
  ListMenusQueryDto,
  MenuListItemResponseDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class ListMenusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    query: ListMenusQueryDto,
  ): Promise<MenuListItemResponseDto[]> {
    await this.branchAccessService.ensureAccess(
      authUser,
      query.branchId,
      [Role.ADMIN, Role.WAITER],
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
