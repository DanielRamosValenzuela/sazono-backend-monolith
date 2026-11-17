import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type {
  MenuListItemResponseDto,
  UpdateMenuDto,
} from '../presentation/http/dto/menus.dto';
import { mapMenuListItem } from './menu-mapper';

@Injectable()
export class UpdateMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    menuId: string,
    dto: UpdateMenuDto,
  ): Promise<MenuListItemResponseDto> {
    const menu = await this.prisma.menu.findUnique({
      where: { id: menuId },
      select: { branchId: true },
    });

    if (!menu) {
      throw new BadRequestException('La carta indicada no existe.');
    }

    await this.branchAccessService.ensureAccess(authUser, menu.branchId, [
      Role.ADMIN,
    ]);

    const [updated, settings] = await Promise.all([
      this.prisma.menu.update({
        where: { id: menuId },
        data: { name: dto.name.trim() },
        include: { categories: { include: { items: true } } },
      }),
      this.prisma.branchSettings.findUnique({
        where: { branchId: menu.branchId },
      }),
    ]);

    return mapMenuListItem(updated, settings?.defaultMenuId === menuId);
  }
}
