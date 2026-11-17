import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { mapModifierOption } from './menu-mapper';
import type { ModifierOptionResponseDto } from '../presentation/http/dto/menus.dto';

const BUCKET_NAME = 'menu-media';

@Injectable()
export class RemoveModifierOptionImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    modifierOptionId: string,
  ): Promise<ModifierOptionResponseDto> {
    const option = await this.prisma.modifierOption.findUnique({
      where: { id: modifierOptionId },
      include: { modifierGroup: true },
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
      data: { imageUrl: null },
    });

    await this.supabaseService.adminClient.storage
      .from(BUCKET_NAME)
      .remove([`modifier-options/${modifierOptionId}/primary`]);

    return mapModifierOption(updated);
  }
}
