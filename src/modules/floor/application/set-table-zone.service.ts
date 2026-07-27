import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../domain/active-table-session-statuses';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type {
  SetTableZoneDto,
  TableResponseDto,
} from '../presentation/http/dto/floor.dto';

@Injectable()
export class SetTableZoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    tableId: string,
    dto: SetTableZoneDto,
  ): Promise<TableResponseDto> {
    const table = await this.prisma.table.findUnique({
      where: {
        id: tableId,
      },
    });

    if (!table) {
      throw new BadRequestException('La mesa indicada no existe.');
    }

    await this.branchAccessService.ensureAccess(authUser, table.branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
    ]);

    const effectiveZoneId = dto.zoneId ?? null;

    if (effectiveZoneId !== null) {
      const zone = await this.prisma.tableZone.findFirst({
        where: {
          id: effectiveZoneId,
          branchId: table.branchId,
        },
      });

      if (!zone) {
        throw new BadRequestException(
          'La zona indicada no existe en esta sucursal.',
        );
      }
    }

    const branchSettings = await this.prisma.branchSettings.findUnique({
      where: {
        branchId: table.branchId,
      },
      select: {
        tableAssignmentEnabled: true,
      },
    });
    const isTableAssignmentEnabled =
      branchSettings?.tableAssignmentEnabled ?? false;

    const updatedTable = await this.prisma.table.update({
      where: {
        id: tableId,
      },
      data: {
        zoneId: effectiveZoneId,
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
    });

    return {
      tableId: updatedTable.id,
      branchId: updatedTable.branchId,
      code: updatedTable.code,
      name: updatedTable.name,
      capacity: updatedTable.capacity,
      status: updatedTable.status,
      qrToken: updatedTable.qrToken,
      zoneId: updatedTable.zoneId,
      currentSession: updatedTable.tableSessions[0]
        ? {
            tableSessionId: updatedTable.tableSessions[0].id,
            status: updatedTable.tableSessions[0].status,
            openedBySource: updatedTable.tableSessions[0].openedBySource,
            openedAt: updatedTable.tableSessions[0].openedAt.toISOString(),
            assignedStaffUserId: isTableAssignmentEnabled
              ? updatedTable.tableSessions[0].assignedStaffUserId
              : null,
            guestCount: updatedTable.tableSessions[0].guestCount,
          }
        : null,
    };
  }
}
