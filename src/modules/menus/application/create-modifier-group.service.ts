import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
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

    const group = await this.prisma.modifierGroup.create({
      data: {
        branchId: dto.branchId,
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

    return mapModifierGroup(group);
  }
}
