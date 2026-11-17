import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { MenuStatus, Role, TranslationEntityType } from '@prisma/client';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

@Injectable()
export class DeleteMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(authUser: JwtPayload, menuId: string): Promise<void> {
    const menu = await this.prisma.menu.findUnique({
      where: { id: menuId },
      include: {
        categories: {
          select: {
            id: true,
            parentId: true,
            items: { select: { id: true } },
          },
        },
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
        'Solo se puede eliminar una carta en estado DRAFT. Las cartas publicadas o archivadas se conservan.',
      );
    }

    const parentById = new Map(
      menu.categories.map((category) => [category.id, category.parentId]),
    );
    const levels: string[][] = [];

    for (const category of menu.categories) {
      let depth = 0;
      let parentId = category.parentId;

      while (parentId && depth <= menu.categories.length) {
        depth += 1;
        parentId = parentById.get(parentId) ?? null;
      }

      (levels[depth] ??= []).push(category.id);
    }

    const itemIds = menu.categories.flatMap((category) =>
      category.items.map((item) => item.id),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.translation.deleteMany({
        where: {
          OR: [
            {
              entityType: TranslationEntityType.MENU_CATEGORY,
              entityId: { in: menu.categories.map((category) => category.id) },
            },
            {
              entityType: TranslationEntityType.MENU_ITEM,
              entityId: { in: itemIds },
            },
          ],
        },
      });

      for (let depth = levels.length - 1; depth >= 0; depth -= 1) {
        await tx.menuCategory.deleteMany({
          where: { id: { in: levels[depth] } },
        });
      }

      await tx.menu.delete({ where: { id: menu.id } });
    });
  }
}
