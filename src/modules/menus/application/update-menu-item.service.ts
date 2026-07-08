import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { MenuStatus, PreparationStationStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { MenusBranchAdminAccessService } from './menus-branch-admin-access.service';
import type {
  MenuItemResponseDto,
  UpdateMenuItemDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class UpdateMenuItemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly menusBranchAdminAccessService: MenusBranchAdminAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    menuItemId: string,
    dto: UpdateMenuItemDto,
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

    const branchId = item.menuCategory.menu.branchId;

    await this.menusBranchAdminAccessService.ensureAdminAccess(
      authUser,
      branchId,
    );

    if (item.menuCategory.menu.status !== MenuStatus.DRAFT) {
      throw new ConflictException(
        'Solo se pueden editar items sobre una carta en estado DRAFT.',
      );
    }

    if (dto.preparationStationId !== undefined) {
      const station = await this.prisma.preparationStation.findUnique({
        where: {
          id: dto.preparationStationId,
        },
      });

      if (!station || station.branchId !== branchId) {
        throw new BadRequestException(
          'La estacion indicada no pertenece a la sucursal de la carta.',
        );
      }

      if (station.status !== PreparationStationStatus.ACTIVE) {
        throw new BadRequestException(
          'La estacion indicada no esta activa para asignar items.',
        );
      }
    }

    const updated = await this.prisma.menuItem.update({
      where: {
        id: menuItemId,
      },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() || null }
          : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.sku !== undefined ? { sku: dto.sku.trim() || null } : {}),
        ...(dto.itemType !== undefined ? { itemType: dto.itemType } : {}),
        ...(dto.preparationStationId !== undefined
          ? { preparationStationId: dto.preparationStationId }
          : {}),
        ...(dto.isAvailable !== undefined
          ? { isAvailable: dto.isAvailable }
          : {}),
      },
      include: {
        preparationStation: true,
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
      preparationStation: {
        preparationStationId: updated.preparationStation.id,
        name: updated.preparationStation.name,
        stationType: updated.preparationStation.stationType,
        status: updated.preparationStation.status,
      },
    };
  }
}
