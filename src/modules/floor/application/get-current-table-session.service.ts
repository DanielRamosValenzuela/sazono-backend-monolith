import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../domain/active-table-session-statuses';
import { FloorBranchAccessService } from './floor-branch-access.service';
import type { TableSessionResponseDto } from '../presentation/http/dto/floor.dto';

@Injectable()
export class GetCurrentTableSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly floorBranchAccessService: FloorBranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    tableId: string,
  ): Promise<TableSessionResponseDto> {
    const table = await this.prisma.table.findUnique({
      where: {
        id: tableId,
      },
    });

    if (!table) {
      throw new BadRequestException('La mesa indicada no existe.');
    }

    await this.floorBranchAccessService.ensureAccess(authUser, table.branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
      Role.WAITER,
      Role.CASHIER,
    ]);

    const currentSession = await this.prisma.tableSession.findFirst({
      where: {
        tableId,
        status: {
          in: ACTIVE_TABLE_SESSION_STATUSES,
        },
      },
      orderBy: {
        openedAt: 'desc',
      },
    });

    if (!currentSession) {
      throw new BadRequestException(
        'La mesa no tiene una sesion activa para retomar.',
      );
    }

    return {
      tableSessionId: currentSession.id,
      tableId: currentSession.tableId,
      branchId: currentSession.branchId,
      status: currentSession.status,
      openedBySource: currentSession.openedBySource,
      openedAt: currentSession.openedAt.toISOString(),
      closeReason: currentSession.closeReason,
      closedAt: currentSession.closedAt?.toISOString() ?? null,
    };
  }
}
