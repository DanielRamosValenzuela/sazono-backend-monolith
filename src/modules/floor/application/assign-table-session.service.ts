import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { BranchRoleStatus, Role, StaffUserStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../domain/active-table-session-statuses';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type {
  AssignTableSessionDto,
  TableSessionResponseDto,
} from '../presentation/http/dto/floor.dto';

const FLOOR_ASSIGN_ROLES: Role[] = [
  Role.ADMIN,
  Role.SUPERVISOR,
  Role.WAITER,
  Role.CASHIER,
];

const FLOOR_REASSIGN_ANYONE_ROLES: Role[] = [Role.ADMIN, Role.SUPERVISOR];

@Injectable()
export class AssignTableSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    tableSessionId: string,
    dto: AssignTableSessionDto,
  ): Promise<TableSessionResponseDto> {
    const existingSession = await this.prisma.tableSession.findUnique({
      where: {
        id: tableSessionId,
      },
    });

    if (!existingSession) {
      throw new BadRequestException('La sesion indicada no existe.');
    }

    if (!ACTIVE_TABLE_SESSION_STATUSES.includes(existingSession.status)) {
      throw new BadRequestException(
        'Solo se puede asignar una sesion de mesa activa.',
      );
    }

    const context = await this.branchAccessService.ensureAccess(
      authUser,
      existingSession.branchId,
      FLOOR_ASSIGN_ROLES,
    );

    const branchSettings = await this.prisma.branchSettings.findUnique({
      where: {
        branchId: existingSession.branchId,
      },
      select: {
        tableAssignmentEnabled: true,
      },
    });

    if (!branchSettings?.tableAssignmentEnabled) {
      throw new BadRequestException(
        'La asignacion formal de mesas no esta activada para esta sucursal.',
      );
    }

    const canAssignAnyone = context.roles.some((role) =>
      FLOOR_REASSIGN_ANYONE_ROLES.includes(role),
    );
    const targetStaffUserId = dto.staffUserId ?? context.staffUserId;

    if (!canAssignAnyone && targetStaffUserId !== context.staffUserId) {
      throw new ForbiddenException(
        'Solo puedes asignarte la mesa a ti mismo. Pide a un admin o supervisor que la reasigne a otro miembro del equipo.',
      );
    }

    if (targetStaffUserId !== context.staffUserId) {
      const targetHasAccess = await this.prisma.staffUserBranchRole.findFirst({
        where: {
          staffUserId: targetStaffUserId,
          branchId: existingSession.branchId,
          status: BranchRoleStatus.ACTIVE,
          role: {
            in: FLOOR_ASSIGN_ROLES,
          },
          staffUser: {
            status: StaffUserStatus.ACTIVE,
          },
        },
        select: {
          staffUserId: true,
        },
      });

      if (!targetHasAccess) {
        throw new BadRequestException(
          'El staff indicado no tiene un rol operativo activo en esta sucursal.',
        );
      }
    }

    const updatedSession = await this.prisma.tableSession.update({
      where: {
        id: tableSessionId,
      },
      data: {
        assignedStaffUserId: targetStaffUserId,
      },
    });

    return {
      tableSessionId: updatedSession.id,
      tableId: updatedSession.tableId,
      branchId: updatedSession.branchId,
      status: updatedSession.status,
      openedBySource: updatedSession.openedBySource,
      openedAt: updatedSession.openedAt.toISOString(),
      closeReason: updatedSession.closeReason,
      closedAt: updatedSession.closedAt?.toISOString() ?? null,
      assignedStaffUserId: updatedSession.assignedStaffUserId,
    };
  }
}
