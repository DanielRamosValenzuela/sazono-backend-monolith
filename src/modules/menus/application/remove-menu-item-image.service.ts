import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { MenuStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { MenusBranchAdminAccessService } from './menus-branch-admin-access.service';
import type { MenuItemResponseDto } from '../presentation/http/dto/menus.dto';

const BUCKET_NAME = 'menu-media';

@Injectable()
export class RemoveMenuItemImageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly menusBranchAdminAccessService: MenusBranchAdminAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    menuItemId: string,
  ): Promise<MenuItemResponseDto> {
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

    await this.menusBranchAdminAccessService.ensureAdminAccess(
      authUser,
      item.menuCategory.menu.branchId,
    );

    if (item.menuCategory.menu.status !== MenuStatus.DRAFT) {
      throw new ConflictException(
        'Solo se pueden editar imagenes sobre una carta en estado DRAFT.',
      );
    }

    await this.prisma.menuItemMedia.deleteMany({
      where: {
        menuItemId,
      },
    });

    await this.supabaseService.adminClient.storage
      .from(BUCKET_NAME)
      .remove([`menu-items/${menuItemId}/primary`]);

    const updated = await this.prisma.menuItem.findUniqueOrThrow({
      where: {
        id: menuItemId,
      },
      include: {
        preparationStation: true,
        media: true,
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
      imageUrl: null,
      preparationStation: {
        preparationStationId: updated.preparationStation.id,
        name: updated.preparationStation.name,
        stationType: updated.preparationStation.stationType,
        status: updated.preparationStation.status,
      },
    };
  }
}
