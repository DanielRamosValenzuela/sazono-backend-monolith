import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BillStatus,
  Role,
  TableSessionStatus,
  TableStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../domain/active-table-session-statuses';
import { FloorBranchAccessService } from './floor-branch-access.service';
import type {
  AbandonTableSessionDto,
  TableSessionResponseDto,
} from '../presentation/http/dto/floor.dto';

@Injectable()
export class AbandonTableSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly floorBranchAccessService: FloorBranchAccessService,
  ) {}

  /**
   * Resolucion operativa de deuda o abandono: solo caja, supervisor o admin
   * pueden cerrar el caso. La sesion y su cuenta quedan ABANDONED aunque
   * exista saldo pendiente, y la mesa vuelve a estar disponible.
   */
  async execute(
    authUser: JwtPayload,
    tableSessionId: string,
    dto: AbandonTableSessionDto,
  ): Promise<TableSessionResponseDto> {
    const existingSession = await this.prisma.tableSession.findUnique({
      where: {
        id: tableSessionId,
      },
      include: {
        bill: true,
      },
    });

    if (!existingSession) {
      throw new BadRequestException('La sesion indicada no existe.');
    }

    if (!ACTIVE_TABLE_SESSION_STATUSES.includes(existingSession.status)) {
      throw new BadRequestException(
        'La sesion indicada no esta activa y no puede marcarse como abandonada.',
      );
    }

    const context = await this.floorBranchAccessService.ensureAccess(
      authUser,
      existingSession.branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.CASHIER],
    );

    const closeReason = dto.closeReason.trim();

    if (closeReason.length === 0) {
      throw new BadRequestException(
        'Debes indicar un motivo para marcar el abandono o la deuda.',
      );
    }

    const abandonedSession = await this.prisma.$transaction(async (tx) => {
      const closedAt = new Date();

      const updatedSession = await tx.tableSession.update({
        where: {
          id: existingSession.id,
        },
        data: {
          status: TableSessionStatus.ABANDONED,
          closedByStaffUserId: context.staffUserId,
          closeReason,
          closedAt,
        },
      });

      if (existingSession.bill) {
        await tx.bill.update({
          where: {
            id: existingSession.bill.id,
          },
          data: {
            status: BillStatus.ABANDONED,
            resolvedByStaffUserId: context.staffUserId,
            closeReason,
            closedAt,
          },
        });
      }

      await tx.table.update({
        where: {
          id: existingSession.tableId,
        },
        data: {
          status: TableStatus.AVAILABLE,
        },
      });

      return updatedSession;
    });

    return {
      tableSessionId: abandonedSession.id,
      tableId: abandonedSession.tableId,
      branchId: abandonedSession.branchId,
      status: abandonedSession.status,
      openedBySource: abandonedSession.openedBySource,
      openedAt: abandonedSession.openedAt.toISOString(),
      closeReason: abandonedSession.closeReason,
      closedAt: abandonedSession.closedAt?.toISOString() ?? null,
    };
  }
}
