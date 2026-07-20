import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { mapModifierOption } from './menu-mapper';
import type {
  ModifierOptionResponseDto,
  UpdateModifierOptionDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class UpdateModifierOptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    modifierOptionId: string,
    dto: UpdateModifierOptionDto,
  ): Promise<ModifierOptionResponseDto> {
    const option = await this.prisma.modifierOption.findUnique({
      where: { id: modifierOptionId },
      include: {
        modifierGroup: true,
      },
    });

    if (!option) {
      throw new BadRequestException(
        'La opcion de modificador indicada no existe.',
      );
    }

    await this.branchAccessService.ensureAccess(
      authUser,
      option.modifierGroup.branchId,
      [Role.ADMIN],
    );

    const updated = await this.prisma.modifierOption.update({
      where: { id: modifierOptionId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.priceDelta !== undefined
          ? { priceDelta: dto.priceDelta }
          : {}),
        ...(dto.isAvailable !== undefined
          ? { isAvailable: dto.isAvailable }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });

    return mapModifierOption(updated);
  }
}
