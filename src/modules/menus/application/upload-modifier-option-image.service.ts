import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { mapModifierOption } from './menu-mapper';
import type { ModifierOptionResponseDto } from '../presentation/http/dto/menus.dto';

const BUCKET_NAME = 'menu-media';
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

type UploadedFile = {
  buffer: Buffer;
  mimetype: string;
  size: number;
};

@Injectable()
export class UploadModifierOptionImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    modifierOptionId: string,
    file: UploadedFile | undefined,
  ): Promise<ModifierOptionResponseDto> {
    if (!file) {
      throw new BadRequestException('Debes adjuntar un archivo de imagen.');
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        'Solo se aceptan imagenes JPEG, PNG o WEBP.',
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('La imagen no puede superar los 5MB.');
    }

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

    const storagePath = `modifier-options/${modifierOptionId}/primary`;

    const { error: uploadError } =
      await this.supabaseService.adminClient.storage
        .from(BUCKET_NAME)
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

    if (uploadError) {
      throw new BadRequestException(
        `No se pudo subir la imagen: ${uploadError.message}`,
      );
    }

    const { data: publicUrlData } = this.supabaseService.adminClient.storage
      .from(BUCKET_NAME)
      .getPublicUrl(storagePath);

    const updated = await this.prisma.modifierOption.update({
      where: { id: modifierOptionId },
      data: { imageUrl: `${publicUrlData.publicUrl}?v=${Date.now()}` },
    });

    return mapModifierOption(updated);
  }
}
