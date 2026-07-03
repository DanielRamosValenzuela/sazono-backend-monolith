import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../domain/active-table-session-statuses';
import { FloorBranchAccessService } from './floor-branch-access.service';
import type {
  ListTablesQueryDto,
  TableResponseDto,
} from '../presentation/http/dto/floor.dto';

@Injectable()
export class ListTablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly floorBranchAccessService: FloorBranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    query: ListTablesQueryDto,
  ): Promise<TableResponseDto[]> {
    await this.floorBranchAccessService.ensureAccess(authUser, query.branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
      Role.WAITER,
      Role.CASHIER,
    ]);

    const tables = await this.prisma.table.findMany({
      where: {
        branchId: query.branchId,
      },
      include: {
        tableSessions: {
          where: {
            status: {
              in: ACTIVE_TABLE_SESSION_STATUSES,
            },
          },
          orderBy: {
            openedAt: 'desc',
          },
          take: 1,
        },
      },
      orderBy: [{ code: 'asc' }, { name: 'asc' }],
    });

    return tables.map((table) => ({
      tableId: table.id,
      branchId: table.branchId,
      code: table.code,
      name: table.name,
      capacity: table.capacity,
      status: table.status,
      qrToken: table.qrToken,
      currentSession: table.tableSessions[0]
        ? {
            tableSessionId: table.tableSessions[0].id,
            status: table.tableSessions[0].status,
            openedBySource: table.tableSessions[0].openedBySource,
            openedAt: table.tableSessions[0].openedAt.toISOString(),
          }
        : null,
    }));
  }
}
