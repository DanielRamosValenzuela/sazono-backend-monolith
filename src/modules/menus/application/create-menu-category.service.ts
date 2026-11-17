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
  CreateMenuCategoryDto,
  MenuCategoryResponseDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class CreateMenuCategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
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

    await this.branchAccessService.ensureAccess(authUser, menu.branchId, [
      Role.ADMIN,
    ]);

    if (menu.status !== MenuStatus.DRAFT) {
      throw new ConflictException(
        'Solo se pueden editar categorias sobre una carta en estado DRAFT.',
      );
    }

    if (dto.parentId) {
      assertValidCategoryParent(
        await this.prisma.menuCategory.findMany({
          where: { menuId },
          select: { id: true, parentId: true },
        }),
        dto.parentId,
        null,
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
        parentId: dto.parentId ?? null,
      },
    });

    return {
      menuCategoryId: category.id,
      menuId: category.menuId,
      name: category.name,
      sortOrder: category.sortOrder,
      status: category.status,
      parentId: category.parentId,
    };
  }
}
