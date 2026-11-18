import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import {
  MODIFIER_MAX_DEPTH,
  modifierGroupDepth,
} from '../domain/modifier-tree';
import { MODIFIER_GROUP_ANCESTRY_INCLUDE } from './modifier-group-include';
import { mapModifierGroup } from './menu-mapper';
import type {
  CreateModifierGroupDto,
  ModifierGroupResponseDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class CreateModifierGroupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    dto: CreateModifierGroupDto,
  ): Promise<ModifierGroupResponseDto> {
    await this.branchAccessService.ensureAccess(authUser, dto.branchId, [
      Role.ADMIN,
    ]);

    const minSelect = dto.minSelect ?? 0;
    const maxSelect = dto.maxSelect ?? null;

    if (maxSelect !== null && maxSelect < minSelect) {
      throw new BadRequestException(
        'El maximo de selecciones no puede ser menor que el minimo.',
      );
    }

    let depth = 1;

    if (dto.parentOptionId) {
      const parentOption = await this.prisma.modifierOption.findUnique({
        where: { id: dto.parentOptionId },
        include: {
          modifierGroup: { include: MODIFIER_GROUP_ANCESTRY_INCLUDE },
        },
      });

      if (
        !parentOption ||
        parentOption.modifierGroup.branchId !== dto.branchId
      ) {
        throw new BadRequestException(
          'La opcion padre indicada no existe en la sucursal.',
        );
      }

      depth = modifierGroupDepth(parentOption.modifierGroup) + 1;

      if (depth > MODIFIER_MAX_DEPTH) {
        throw new BadRequestException(
          `Las opciones anidadas admiten como maximo ${MODIFIER_MAX_DEPTH} niveles.`,
        );
      }
    }

    const group = await this.prisma.modifierGroup.create({
      data: {
        branchId: dto.branchId,
        parentOptionId: dto.parentOptionId ?? null,
        name: dto.name.trim(),
        selectionType: dto.selectionType,
        minSelect,
        maxSelect,
        isRequired: dto.isRequired ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
      include: {
        options: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    return mapModifierGroup(group, depth);
  }
}
