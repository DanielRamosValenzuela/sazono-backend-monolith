import { ConflictException, Injectable } from '@nestjs/common';
import { PreparationStationStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { mapPreparationStation } from './menu-mapper';
import { MenusBranchAdminAccessService } from './menus-branch-admin-access.service';
import type {
  CreatePreparationStationDto,
  PreparationStationResponseDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class CreatePreparationStationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly menusBranchAdminAccessService: MenusBranchAdminAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    dto: CreatePreparationStationDto,
  ): Promise<PreparationStationResponseDto> {
    await this.menusBranchAdminAccessService.ensureAdminAccess(
      authUser,
      dto.branchId,
    );

    const normalizedName = dto.name.trim();
    const existingStation = await this.prisma.preparationStation.findFirst({
      where: {
        branchId: dto.branchId,
        name: {
          equals: normalizedName,
          mode: 'insensitive',
        },
      },
    });

    if (existingStation) {
      throw new ConflictException(
        'Ya existe una estacion con ese nombre en la sucursal.',
      );
    }

    const station = await this.prisma.preparationStation.create({
      data: {
        branchId: dto.branchId,
        name: normalizedName,
        stationType: dto.stationType,
        status: PreparationStationStatus.ACTIVE,
      },
    });

    return mapPreparationStation(station);
  }
}
