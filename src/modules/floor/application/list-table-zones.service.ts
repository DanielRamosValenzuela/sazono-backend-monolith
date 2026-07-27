import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type {
  ListTablesQueryDto,
  TableZoneResponseDto,
} from '../presentation/http/dto/floor.dto';

@Injectable()
export class ListTableZonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    query: ListTablesQueryDto,
  ): Promise<TableZoneResponseDto[]> {
    await this.branchAccessService.ensureAccess(authUser, query.branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
      Role.WAITER,
      Role.CASHIER,
      Role.KITCHEN,
    ]);

    const zones = await this.prisma.tableZone.findMany({
      where: {
        branchId: query.branchId,
      },
      include: {
        tables: {
          select: {
            id: true,
          },
        },
        staffMembers: {
          select: {
            staffUserId: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    return zones.map((zone) => ({
      zoneId: zone.id,
      branchId: zone.branchId,
      name: zone.name,
      tableIds: zone.tables.map((table) => table.id),
      staffUserIds: zone.staffMembers.map((member) => member.staffUserId),
    }));
  }
}
