import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { MenuStatus, PreparationStationStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type {
  CreateMenuItemDto,
  MenuItemResponseDto,
} from '../presentation/http/dto/menus.dto';
import { MenusBranchAdminAccessService } from './menus-branch-admin-access.service';

@Injectable()
export class CreateMenuItemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly menusBranchAdminAccessService: MenusBranchAdminAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    menuCategoryId: string,
    dto: CreateMenuItemDto,
  ): Promise<MenuItemResponseDto> {
    const category = await this.prisma.menuCategory.findUnique({
      where: {
        id: menuCategoryId,
      },
      include: {
        menu: true,
      },
    });

    if (!category) {
      throw new BadRequestException('La categoria indicada no existe.');
    }

    await this.menusBranchAdminAccessService.ensureAdminAccess(
      authUser,
      category.menu.branchId,
    );

    if (category.menu.status !== MenuStatus.DRAFT) {
      throw new ConflictException(
        'Solo se pueden editar items sobre una carta en estado DRAFT.',
      );
    }

    const station = await this.prisma.preparationStation.findUnique({
      where: {
        id: dto.preparationStationId,
      },
    });

    if (!station || station.branchId !== category.menu.branchId) {
      throw new BadRequestException(
        'La estacion indicada no pertenece a la sucursal de la carta.',
      );
    }

    if (station.status !== PreparationStationStatus.ACTIVE) {
      throw new BadRequestException(
        'La estacion indicada no esta activa para asignar items.',
      );
    }

    const item = await this.prisma.menuItem.create({
      data: {
        menuCategoryId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        price: dto.price,
        sku: dto.sku?.trim() || null,
        itemType: dto.itemType,
        preparationStationId: dto.preparationStationId,
        isAvailable: dto.isAvailable ?? true,
      },
      include: {
        preparationStation: true,
      },
    });

    return {
      menuItemId: item.id,
      menuCategoryId: item.menuCategoryId,
      name: item.name,
      description: item.description,
      price: item.price.toString(),
      sku: item.sku,
      itemType: item.itemType,
      isAvailable: item.isAvailable,
      preparationStation: {
        preparationStationId: item.preparationStation.id,
        name: item.preparationStation.name,
        stationType: item.preparationStation.stationType,
        status: item.preparationStation.status,
      },
    };
  }
}
