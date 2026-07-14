import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { mapPreparationStation } from './menu-mapper';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type {
  ListPreparationStationsQueryDto,
  PreparationStationResponseDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class ListPreparationStationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    query: ListPreparationStationsQueryDto,
  ): Promise<PreparationStationResponseDto[]> {
    await this.branchAccessService.ensureAccess(authUser, query.branchId, [
      Role.ADMIN,
    ]);

    const stations = await this.prisma.preparationStation.findMany({
      where: {
        branchId: query.branchId,
      },
      orderBy: [{ name: 'asc' }],
    });

    return stations.map(mapPreparationStation);
  }
}
