import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { mapMenuDetail } from './menu-mapper';
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

    const branchSettings = await this.prisma.branchSettings.findUniqueOrThrow({
      where: {
        branchId: menu.branchId,
      },
    });

    await this.menusBranchAdminAccessService.ensureAdminAccess(
      authUser,
      menu.branchId,
    );

    return mapMenuDetail(menu, branchSettings.defaultMenuId === menu.id);
  }
}
