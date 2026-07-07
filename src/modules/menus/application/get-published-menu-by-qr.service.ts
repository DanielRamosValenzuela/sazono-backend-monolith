import { Injectable, NotFoundException } from '@nestjs/common';
import { MenuCategoryStatus, MenuStatus, TableStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { mapMenuDetail } from './menu-mapper';
import type { MenuDetailResponseDto } from '../presentation/http/dto/menus.dto';

@Injectable()
export class GetPublishedMenuByQrService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lectura publica de la carta activa de la sucursal a partir del QR de la
   * mesa. Solo expone categorias activas e items disponibles.
   */
  async execute(qrToken: string): Promise<MenuDetailResponseDto> {
    const table = await this.prisma.table.findUnique({
      where: {
        qrToken,
      },
      include: {
        branch: {
          include: {
            settings: {
              include: {
                defaultMenu: true,
              },
            },
          },
        },
      },
    });

    if (!table || table.status === TableStatus.DISABLED) {
      throw new NotFoundException('El QR indicado no esta disponible.');
    }

    const defaultMenu = table.branch.settings?.defaultMenu;

    if (!defaultMenu || defaultMenu.status !== MenuStatus.PUBLISHED) {
      throw new NotFoundException(
        'La sucursal no tiene una carta publicada disponible.',
      );
    }

    const menu = await this.prisma.menu.findUniqueOrThrow({
      where: {
        id: defaultMenu.id,
      },
      include: {
        categories: {
          where: {
            status: MenuCategoryStatus.ACTIVE,
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            items: {
              where: {
                isAvailable: true,
              },
              orderBy: [{ name: 'asc' }],
              include: {
                preparationStation: true,
              },
            },
          },
        },
      },
    });

    return mapMenuDetail(menu, true);
  }
}
