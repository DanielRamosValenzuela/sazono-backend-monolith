import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { MODIFIER_GROUP_TREE_INCLUDE } from './modifier-group-include';
import { mapModifierGroup } from './menu-mapper';
import type {
  ListModifierGroupsQueryDto,
  ModifierGroupResponseDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class ListModifierGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    query: ListModifierGroupsQueryDto,
  ): Promise<ModifierGroupResponseDto[]> {
    await this.branchAccessService.ensureAccess(authUser, query.branchId, [
      Role.ADMIN,
    ]);

    const groups = await this.prisma.modifierGroup.findMany({
      where: { branchId: query.branchId, parentOptionId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: MODIFIER_GROUP_TREE_INCLUDE,
    });

    return groups.map((group) => mapModifierGroup(group));
  }
}
