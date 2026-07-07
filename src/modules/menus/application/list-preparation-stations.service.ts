import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { mapPreparationStation } from './menu-mapper';
import { MenusBranchAdminAccessService } from './menus-branch-admin-access.service';
import type {
  ListPreparationStationsQueryDto,
  PreparationStationResponseDto,
} from '../presentation/http/dto/menus.dto';

@Injectable()
export class ListPreparationStationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly menusBranchAdminAccessService: MenusBranchAdminAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    query: ListPreparationStationsQueryDto,
  ): Promise<PreparationStationResponseDto[]> {
    await this.menusBranchAdminAccessService.ensureAdminAccess(
      authUser,
      query.branchId,
    );

    const stations = await this.prisma.preparationStation.findMany({
      where: {
        branchId: query.branchId,
      },
      orderBy: [{ name: 'asc' }],
    });

    return stations.map(mapPreparationStation);
  }
}
