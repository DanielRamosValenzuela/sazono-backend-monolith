import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  BillStatus,
  Role,
  TableSessionOpenedBySource,
  TableStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../domain/active-table-session-statuses';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type {
  OpenTableSessionDto,
  TableSessionResponseDto,
} from '../presentation/http/dto/floor.dto';

@Injectable()
export class OpenTableSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    dto: OpenTableSessionDto,
  ): Promise<TableSessionResponseDto> {
    const table = await this.prisma.table.findUnique({
      where: {
        id: dto.tableId,
      },
    });

    if (!table) {
      throw new BadRequestException('La mesa indicada no existe.');
    }

    if (table.status === TableStatus.DISABLED) {
      throw new BadRequestException(
        'No se puede abrir una sesion sobre una mesa deshabilitada.',
      );
    }

    const context = await this.branchAccessService.ensureAccess(
      authUser,
      table.branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.WAITER, Role.CASHIER],
    );

    this.validateOpenedBySource(context.roles, dto.openedBySource);

    const branchSettings = await this.prisma.branchSettings.findUnique({
      where: {
        branchId: table.branchId,
      },
      select: {
        tableAssignmentEnabled: true,
      },
    });
    const initialAssignedStaffUserId = branchSettings?.tableAssignmentEnabled
      ? context.staffUserId
      : null;

    const tableSession = await this.prisma.$transaction(async (tx) => {
      const existingActiveSession = await tx.tableSession.findFirst({
        where: {
          tableId: table.id,
          status: {
            in: ACTIVE_TABLE_SESSION_STATUSES,
          },
        },
      });

      if (existingActiveSession) {
        throw new ConflictException(
          'La mesa ya tiene una sesion activa y no puede abrir otra.',
        );
      }

      const createdSession = await tx.tableSession.create({
        data: {
          tableId: table.id,
          branchId: table.branchId,
          openedBySource: dto.openedBySource,
          openedByStaffUserId: context.staffUserId,
          assignedStaffUserId: initialAssignedStaffUserId,
        },
      });

      await tx.bill.create({
        data: {
          tableSessionId: createdSession.id,
          branchId: table.branchId,
          status: BillStatus.OPEN,
        },
      });

      await tx.table.update({
        where: {
          id: table.id,
        },
        data: {
          status: TableStatus.OCCUPIED,
        },
      });

      return createdSession;
    });

    return {
      tableSessionId: tableSession.id,
      tableId: tableSession.tableId,
      branchId: tableSession.branchId,
      status: tableSession.status,
      openedBySource: tableSession.openedBySource,
      openedAt: tableSession.openedAt.toISOString(),
      closeReason: tableSession.closeReason,
      closedAt: tableSession.closedAt?.toISOString() ?? null,
      assignedStaffUserId: tableSession.assignedStaffUserId,
    };
  }

  private validateOpenedBySource(
    roles: Role[],
    openedBySource: TableSessionOpenedBySource,
  ) {
    if (roles.includes(Role.ADMIN) || roles.includes(Role.SUPERVISOR)) {
      return;
    }

    if (
      openedBySource === TableSessionOpenedBySource.WAITER &&
      roles.includes(Role.WAITER)
    ) {
      return;
    }

    if (
      openedBySource === TableSessionOpenedBySource.CASHIER &&
      roles.includes(Role.CASHIER)
    ) {
      return;
    }

    throw new BadRequestException(
      'El rol autenticado no puede abrir una mesa con ese origen operativo.',
    );
  }
}
