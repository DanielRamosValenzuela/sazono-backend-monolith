import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { MenuStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { MenusBranchAdminAccessService } from './menus-branch-admin-access.service';
import type {
  CreateMenuCategoryDto,
  MenuCategoryResponseDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class CreateMenuCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly menusBranchAdminAccessService: MenusBranchAdminAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    menuId: string,
    dto: CreateMenuCategoryDto,
  ): Promise<MenuCategoryResponseDto> {
    const menu = await this.prisma.menu.findUnique({
      where: {
        id: menuId,
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
        'Solo se pueden editar categorias sobre una carta en estado DRAFT.',
      );
    }

    const nextSortOrder =
      dto.sortOrder ??
      ((
        await this.prisma.menuCategory.aggregate({
          where: {
            menuId,
          },
          _max: {
            sortOrder: true,
          },
        })
      )._max.sortOrder ?? -1) + 1;

    const category = await this.prisma.menuCategory.create({
      data: {
        menuId,
        name: dto.name.trim(),
        sortOrder: nextSortOrder,
      },
    });

    return {
      menuCategoryId: category.id,
      menuId: category.menuId,
      name: category.name,
      sortOrder: category.sortOrder,
      status: category.status,
    };
  }
}
