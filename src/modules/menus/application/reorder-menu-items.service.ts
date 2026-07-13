import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Role, MenuStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { ReorderMenuItemsDto } from '../presentation/http/dto/menus.dto';

@Injectable()
export class ReorderMenuItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    menuCategoryId: string,
    dto: ReorderMenuItemsDto,
  ): Promise<{ reorderedCount: number }> {
    const category = await this.prisma.menuCategory.findUnique({
      where: {
        id: menuCategoryId,
      },
      include: {
        menu: true,
        items: {
          select: {
            id: true,
          },
        },
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
        'Solo se pueden reordenar items sobre una carta en estado DRAFT.',
      );
    }

    const existingIds = new Set(category.items.map((item) => item.id));
    const requestedIds = new Set(dto.orderedItemIds);

    if (
      existingIds.size !== requestedIds.size ||
      ![...existingIds].every((id) => requestedIds.has(id))
    ) {
      throw new BadRequestException(
        'La lista de items no coincide con los items actuales de la categoria.',
      );
    }

    await this.prisma.$transaction(
      dto.orderedItemIds.map((itemId, index) =>
        this.prisma.menuItem.update({
          where: {
            id: itemId,
          },
          data: {
            sortOrder: index,
          },
        }),
      ),
    );

    return { reorderedCount: dto.orderedItemIds.length };
  }
}
