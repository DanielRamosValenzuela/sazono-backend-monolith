import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { mapModifierGroup } from './menu-mapper';
import type {
  ModifierGroupResponseDto,
  SetMenuItemModifierGroupsDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class SetMenuItemModifierGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    menuItemId: string,
    dto: SetMenuItemModifierGroupsDto,
  ): Promise<ModifierGroupResponseDto[]> {
    const item = await this.prisma.menuItem.findUnique({
      where: { id: menuItemId },
      include: {
        menuCategory: {
          include: {
            menu: true,
          },
        },
      },
    });

    if (!item) {
      throw new BadRequestException('El item indicado no existe.');
    }

    const branchId = item.menuCategory.menu.branchId;

    await this.branchAccessService.ensureAccess(authUser, branchId, [
      Role.ADMIN,
    ]);

    const uniqueGroupIds = [...new Set(dto.modifierGroupIds)];

    const groups = await this.prisma.modifierGroup.findMany({
      where: {
        id: { in: uniqueGroupIds },
        branchId,
      },
      include: {
        options: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (groups.length !== uniqueGroupIds.length) {
      throw new BadRequestException(
        'Uno de los grupos de modificadores indicados no pertenece a la sucursal de la carta.',
      );
    }

    const groupsById = new Map(groups.map((group) => [group.id, group]));

    await this.prisma.$transaction([
      this.prisma.menuItemModifierGroup.deleteMany({
        where: { menuItemId },
      }),
      this.prisma.menuItemModifierGroup.createMany({
        data: uniqueGroupIds.map((modifierGroupId, index) => ({
          menuItemId,
          modifierGroupId,
          sortOrder: index,
        })),
      }),
    ]);

    return uniqueGroupIds.map((modifierGroupId) =>
      mapModifierGroup(groupsById.get(modifierGroupId)!),
    );
  }
}
