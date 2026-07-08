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
  MenuCategoryResponseDto,
  UpdateMenuCategoryDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class UpdateMenuCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly menusBranchAdminAccessService: MenusBranchAdminAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    menuCategoryId: string,
    dto: UpdateMenuCategoryDto,
  ): Promise<MenuCategoryResponseDto> {
    const category = await this.prisma.menuCategory.findUnique({
      where: {
        id: menuCategoryId,
      },
      include: {
        menu: true,
      },
    });

    if (!category) {
      throw new BadRequestException('La categoria indicada no existe.');
    }

    await this.menusBranchAdminAccessService.ensureAdminAccess(
      authUser,
      category.menu.branchId,
    );

    if (category.menu.status !== MenuStatus.DRAFT) {
      throw new ConflictException(
        'Solo se pueden editar categorias sobre una carta en estado DRAFT.',
      );
    }

    const updated = await this.prisma.menuCategory.update({
      where: {
        id: menuCategoryId,
      },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });

    return {
      menuCategoryId: updated.id,
      menuId: updated.menuId,
      name: updated.name,
      sortOrder: updated.sortOrder,
      status: updated.status,
    };
  }
}
