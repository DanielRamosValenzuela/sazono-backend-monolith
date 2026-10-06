import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../domain/active-table-session-statuses';
import { COUNTER_SESSION_ROLES } from '../domain/counter-table';
import type {
  CounterSessionResponseDto,
  RenameCounterSessionDto,
} from '../presentation/http/dto/floor.dto';

@Injectable()
export class RenameCounterSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    tableSessionId: string,
    dto: RenameCounterSessionDto,
  ): Promise<CounterSessionResponseDto> {
    const existing = await this.prisma.tableSession.findUnique({
      where: { id: tableSessionId },
      include: { bill: { select: { id: true } } },
    });

    if (!existing || !existing.isCounter) {
      throw new BadRequestException(
        'La sesion de mesa virtual indicada no existe.',
      );
    }

    await this.branchAccessService.ensureAccess(
      authUser,
      existing.branchId,
      COUNTER_SESSION_ROLES,
    );

    if (!ACTIVE_TABLE_SESSION_STATUSES.includes(existing.status)) {
      throw new BadRequestException(
        'Solo se puede renombrar un ticket de mesa virtual activo.',
      );
    }

    const updated = await this.prisma.tableSession.update({
      where: { id: tableSessionId },
      data: { customerLabel: dto.customerLabel || null },
    });

    return {
      tableSessionId: updated.id,
      tableId: updated.tableId,
      branchId: updated.branchId,
      billId: existing.bill?.id ?? null,
      ticketNumber: updated.ticketNumber!,
      customerLabel: updated.customerLabel,
      status: updated.status,
      openedByStaffUserId: updated.openedByStaffUserId,
      assignedStaffUserId: updated.assignedStaffUserId,
      openedAt: updated.openedAt.toISOString(),
    };
  }
}
