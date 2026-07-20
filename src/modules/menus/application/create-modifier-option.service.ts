import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { mapModifierOption } from './menu-mapper';
import type {
  CreateModifierOptionDto,
  ModifierOptionResponseDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class CreateModifierOptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    modifierGroupId: string,
    dto: CreateModifierOptionDto,
  ): Promise<ModifierOptionResponseDto> {
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

    const option = await this.prisma.modifierOption.create({
      data: {
        modifierGroupId,
        name: dto.name.trim(),
        priceDelta: dto.priceDelta ?? '0',
        isAvailable: dto.isAvailable ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    return mapModifierOption(option);
  }
}
