import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Role, MenuStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { MenuItemResponseDto } from '../presentation/http/dto/menus.dto';

const BUCKET_NAME = 'menu-media';
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

type UploadedFile = {
  buffer: Buffer;
  mimetype: string;
  size: number;
};

@Injectable()
export class UploadMenuItemImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    menuItemId: string,
    file: UploadedFile | undefined,
  ): Promise<MenuItemResponseDto> {
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

    const item = await this.prisma.menuItem.findUnique({
      where: {
        id: menuItemId,
      },
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

    await this.branchAccessService.ensureAccess(
      authUser,
      item.menuCategory.menu.branchId,
      [Role.ADMIN],
    );

    if (item.menuCategory.menu.status !== MenuStatus.DRAFT) {
      throw new ConflictException(
        'Solo se pueden editar imagenes sobre una carta en estado DRAFT.',
      );
    }

    const storagePath = `menu-items/${menuItemId}/primary`;

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

    await this.prisma.$transaction([
      this.prisma.menuItemMedia.deleteMany({
        where: {
          menuItemId,
        },
      }),
      this.prisma.menuItemMedia.create({
        data: {
          menuItemId,
          mediaType: 'IMAGE',
          url: publicUrlData.publicUrl,
          sortOrder: 0,
        },
      }),
    ]);

    const updated = await this.prisma.menuItem.findUniqueOrThrow({
      where: {
        id: menuItemId,
      },
      include: {
        preparationStation: true,
        media: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
      },
    });

    return {
      menuItemId: updated.id,
      menuCategoryId: updated.menuCategoryId,
      name: updated.name,
      description: updated.description,
      price: updated.price.toString(),
      sku: updated.sku,
      itemType: updated.itemType,
      isAvailable: updated.isAvailable,
      sortOrder: updated.sortOrder,
      imageUrl: updated.media[0]?.url ?? null,
      preparationStation: {
        preparationStationId: updated.preparationStation.id,
        name: updated.preparationStation.name,
        stationType: updated.preparationStation.stationType,
        status: updated.preparationStation.status,
      },
    };
  }
}
