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
  CloseTableSessionDto,
  TableSessionResponseDto,
} from '../presentation/http/dto/floor.dto';

@Injectable()
export class CloseTableSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly floorBranchAccessService: FloorBranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    tableSessionId: string,
    dto: CloseTableSessionDto,
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
        'La sesion indicada no esta activa y no puede cerrarse manualmente.',
      );
    }

    const context = await this.floorBranchAccessService.ensureAccess(
      authUser,
      existingSession.branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.WAITER, Role.CASHIER],
    );

    const normalizedCloseReason = this.normalizeCloseReason(dto.closeReason);

    const closedSession = await this.prisma.$transaction(async (tx) => {
      const bill =
        existingSession.bill ??
        (await tx.bill.create({
          data: {
            tableSessionId: existingSession.id,
            branchId: existingSession.branchId,
            status: BillStatus.OPEN,
          },
        }));

      if (bill.remainingAmount.gt(0)) {
        throw new BadRequestException(
          'No se puede cerrar la mesa porque la cuenta aun tiene saldo pendiente.',
        );
      }

      const closedAt = new Date();

      const updatedSession = await tx.tableSession.update({
        where: {
          id: existingSession.id,
        },
        data: {
          status: TableSessionStatus.CLOSED,
          closedByStaffUserId: context.staffUserId,
          closeReason: normalizedCloseReason,
          closedAt,
        },
      });

      await tx.table.update({
        where: {
          id: existingSession.tableId,
        },
        data: {
          status: TableStatus.AVAILABLE,
        },
      });

      await tx.bill.update({
        where: {
          id: bill.id,
        },
        data: {
          status: BillStatus.PAID,
          resolvedByStaffUserId: context.staffUserId,
          closeReason: normalizedCloseReason,
          closedAt,
        },
      });

      return updatedSession;
    });

    return {
      tableSessionId: closedSession.id,
      tableId: closedSession.tableId,
      branchId: closedSession.branchId,
      status: closedSession.status,
      openedBySource: closedSession.openedBySource,
      openedAt: closedSession.openedAt.toISOString(),
      closeReason: closedSession.closeReason,
      closedAt: closedSession.closedAt?.toISOString() ?? null,
    };
  }

  private normalizeCloseReason(value?: string): string | null {
    if (!value) {
      return null;
    }

    const normalizedValue = value.trim();

    return normalizedValue.length > 0 ? normalizedValue : null;
  }
}
