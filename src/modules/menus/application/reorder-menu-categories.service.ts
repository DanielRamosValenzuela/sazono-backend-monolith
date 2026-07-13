import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Role, MenuStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { ReorderMenuCategoriesDto } from '../presentation/http/dto/menus.dto';

@Injectable()
export class ReorderMenuCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    menuId: string,
    dto: ReorderMenuCategoriesDto,
  ): Promise<{ reorderedCount: number }> {
    const menu = await this.prisma.menu.findUnique({
      where: {
        id: menuId,
      },
      include: {
        categories: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!menu) {
      throw new BadRequestException('La carta indicada no existe.');
    }

    await this.branchAccessService.ensureAccess(
      authUser,
      menu.branchId,
      [Role.ADMIN],
    );

    if (menu.status !== MenuStatus.DRAFT) {
      throw new ConflictException(
        'Solo se pueden reordenar categorias sobre una carta en estado DRAFT.',
      );
    }

    const existingIds = new Set(menu.categories.map((category) => category.id));
    const requestedIds = new Set(dto.orderedCategoryIds);

    if (
      existingIds.size !== requestedIds.size ||
      ![...existingIds].every((id) => requestedIds.has(id))
    ) {
      throw new BadRequestException(
        'La lista de categorias no coincide con las categorias actuales de la carta.',
      );
    }

    await this.prisma.$transaction(
      dto.orderedCategoryIds.map((categoryId, index) =>
        this.prisma.menuCategory.update({
          where: {
            id: categoryId,
          },
          data: {
            sortOrder: index,
          },
        }),
      ),
    );

    return { reorderedCount: dto.orderedCategoryIds.length };
  }
}
