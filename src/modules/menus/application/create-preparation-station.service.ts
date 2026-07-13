import { ConflictException, Injectable } from '@nestjs/common';
import { Role, PreparationStationStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { mapPreparationStation } from './menu-mapper';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type {
  CreatePreparationStationDto,
  PreparationStationResponseDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class CreatePreparationStationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    dto: CreatePreparationStationDto,
  ): Promise<PreparationStationResponseDto> {
    await this.branchAccessService.ensureAccess(
      authUser,
      dto.branchId,
      [Role.ADMIN],
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
