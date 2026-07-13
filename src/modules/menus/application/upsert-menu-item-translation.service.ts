import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Role, MenuStatus, TranslationEntityType } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { UpsertItemTranslationDto } from '../presentation/http/dto/menus.dto';

@Injectable()
export class UpsertMenuItemTranslationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    menuItemId: string,
    locale: string,
    dto: UpsertItemTranslationDto,
  ): Promise<{ locale: string; name: string; description: string | null }> {
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
        'Solo se pueden editar traducciones sobre una carta en estado DRAFT.',
      );
    }

    const description = dto.description?.trim() || null;

    await this.prisma.$transaction([
      this.prisma.translation.deleteMany({
        where: {
          entityType: TranslationEntityType.MENU_ITEM,
          entityId: menuItemId,
          locale,
          fieldName: {
            in: ['name', 'description'],
          },
        },
      }),
      this.prisma.translation.create({
        data: {
          entityType: TranslationEntityType.MENU_ITEM,
          entityId: menuItemId,
          locale,
          fieldName: 'name',
          translatedValue: dto.name.trim(),
        },
      }),
      ...(description
        ? [
            this.prisma.translation.create({
              data: {
                entityType: TranslationEntityType.MENU_ITEM,
                entityId: menuItemId,
                locale,
                fieldName: 'description',
                translatedValue: description,
              },
            }),
          ]
        : []),
    ]);

    return { locale, name: dto.name.trim(), description };
  }
}
