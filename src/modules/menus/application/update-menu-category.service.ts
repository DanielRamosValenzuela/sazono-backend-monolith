import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Role, MenuStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { assertValidCategoryParent } from './menu-category-tree';
import type {
  MenuCategoryResponseDto,
  UpdateMenuCategoryDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class UpdateMenuCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
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

    await this.branchAccessService.ensureAccess(
      authUser,
      category.menu.branchId,
      [Role.ADMIN],
    );

    if (category.menu.status !== MenuStatus.DRAFT) {
      throw new ConflictException(
        'Solo se pueden editar categorias sobre una carta en estado DRAFT.',
      );
    }

    if (dto.parentId) {
      assertValidCategoryParent(
        await this.prisma.menuCategory.findMany({
          where: { menuId: category.menuId },
          select: { id: true, parentId: true },
        }),
        dto.parentId,
        category.id,
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
        ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
      },
    });

    return {
      menuCategoryId: updated.id,
      menuId: updated.menuId,
      name: updated.name,
      sortOrder: updated.sortOrder,
      status: updated.status,
      parentId: updated.parentId,
    };
  }
}
