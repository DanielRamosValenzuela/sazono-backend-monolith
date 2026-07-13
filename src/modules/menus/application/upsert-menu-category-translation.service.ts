import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Role, MenuStatus, TranslationEntityType } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { UpsertCategoryTranslationDto } from '../presentation/http/dto/menus.dto';

@Injectable()
export class UpsertMenuCategoryTranslationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    menuCategoryId: string,
    locale: string,
    dto: UpsertCategoryTranslationDto,
  ): Promise<{ locale: string; name: string; description: string | null }> {
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

    await this.branchAccessService.ensureAccess(
      authUser,
      category.menu.branchId,
      [Role.ADMIN],
    );

    if (category.menu.status !== MenuStatus.DRAFT) {
      throw new ConflictException(
        'Solo se pueden editar traducciones sobre una carta en estado DRAFT.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.translation.deleteMany({
        where: {
          entityType: TranslationEntityType.MENU_CATEGORY,
          entityId: menuCategoryId,
          locale,
          fieldName: 'name',
        },
      }),
      this.prisma.translation.create({
        data: {
          entityType: TranslationEntityType.MENU_CATEGORY,
          entityId: menuCategoryId,
          locale,
          fieldName: 'name',
          translatedValue: dto.name.trim(),
        },
      }),
    ]);

    return { locale, name: dto.name.trim(), description: null };
  }
}
