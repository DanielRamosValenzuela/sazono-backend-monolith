import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { mapModifierGroup } from './menu-mapper';
import type {
  ModifierGroupResponseDto,
  UpdateModifierGroupDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class UpdateModifierGroupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    modifierGroupId: string,
    dto: UpdateModifierGroupDto,
  ): Promise<ModifierGroupResponseDto> {
    const group = await this.prisma.modifierGroup.findUnique({
      where: { id: modifierGroupId },
    });

    if (!group) {
      throw new BadRequestException(
        'El grupo de modificadores indicado no existe.',
      );
    }

    await this.branchAccessService.ensureAccess(authUser, group.branchId, [
      Role.ADMIN,
    ]);

    const nextMinSelect = dto.minSelect ?? group.minSelect;
    const nextMaxSelect =
      dto.maxSelect !== undefined ? dto.maxSelect : group.maxSelect;

    if (nextMaxSelect !== null && nextMaxSelect < nextMinSelect) {
      throw new BadRequestException(
        'El maximo de selecciones no puede ser menor que el minimo.',
      );
    }

    const updated = await this.prisma.modifierGroup.update({
      where: { id: modifierGroupId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.selectionType !== undefined
          ? { selectionType: dto.selectionType }
          : {}),
        ...(dto.minSelect !== undefined ? { minSelect: dto.minSelect } : {}),
        ...(dto.maxSelect !== undefined ? { maxSelect: dto.maxSelect } : {}),
        ...(dto.isRequired !== undefined
          ? { isRequired: dto.isRequired }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      include: {
        options: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    return mapModifierGroup(updated);
  }
}
