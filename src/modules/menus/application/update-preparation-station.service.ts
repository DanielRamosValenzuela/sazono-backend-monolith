import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { mapPreparationStation } from './menu-mapper';
import type {
  PreparationStationResponseDto,
  UpdatePreparationStationDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class UpdatePreparationStationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    preparationStationId: string,
    dto: UpdatePreparationStationDto,
  ): Promise<PreparationStationResponseDto> {
    const station = await this.prisma.preparationStation.findUnique({
      where: {
        id: preparationStationId,
      },
    });

    if (!station) {
      throw new BadRequestException('La estacion indicada no existe.');
    }

    await this.branchAccessService.ensureAccess(authUser, station.branchId, [
      Role.ADMIN,
    ]);

    const normalizedName = dto.name?.trim();

    if (normalizedName) {
      const existingStation = await this.prisma.preparationStation.findFirst({
        where: {
          branchId: station.branchId,
          id: {
            not: station.id,
          },
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
    }

    const updatedStation = await this.prisma.preparationStation.update({
      where: {
        id: station.id,
      },
      data: {
        ...(normalizedName ? { name: normalizedName } : {}),
        ...(dto.stationType ? { stationType: dto.stationType } : {}),
        ...(dto.status ? { status: dto.status } : {}),
      },
    });

    return mapPreparationStation(updatedStation);
  }
}
