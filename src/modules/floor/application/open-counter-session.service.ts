import { ConflictException, Injectable } from '@nestjs/common';
import {
  BillStatus,
  Prisma,
  Role,
  TableSessionOpenedBySource,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../domain/active-table-session-statuses';
import {
  COUNTER_SESSION_ROLES,
  COUNTER_TICKET_MAX,
} from '../domain/counter-table';
import type {
  CounterSessionResponseDto,
  OpenCounterSessionDto,
} from '../presentation/http/dto/floor.dto';
import { EnsureCounterTableService } from './ensure-counter-table.service';
import { allocateBillNumber } from '../../billing/application/allocate-bill-number';

const ALL_TICKETS_TAKEN_MESSAGE =
  'Hay demasiados tickets de mesa virtual activos. Cierra algunos antes de abrir otro.';

@Injectable()
export class OpenCounterSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
    private readonly ensureCounterTableService: EnsureCounterTableService,
  ) {}

  async execute(
    authUser: JwtPayload,
    dto: OpenCounterSessionDto,
  ): Promise<CounterSessionResponseDto> {
    const context = await this.branchAccessService.ensureAccess(
      authUser,
      dto.branchId,
      COUNTER_SESSION_ROLES,
    );

    const table = await this.ensureCounterTableService.execute(dto.branchId);

    const branchSettings = await this.prisma.branchSettings.findUnique({
      where: { branchId: dto.branchId },
      select: { tableAssignmentEnabled: true },
    });
    const assignedStaffUserId = branchSettings?.tableAssignmentEnabled
      ? context.staffUserId
      : null;
    const openedBySource =
      context.roles.includes(Role.CASHIER) &&
      !context.roles.includes(Role.WAITER)
        ? TableSessionOpenedBySource.CASHIER
        : TableSessionOpenedBySource.WAITER;

    try {
      const { session, bill } = await this.prisma.$transaction(async (tx) => {
        const ticketNumber = await this.allocateTicket(
          tx,
          table.id,
          dto.branchId,
        );

        const createdSession = await tx.tableSession.create({
          data: {
            tableId: table.id,
            branchId: dto.branchId,
            openedBySource,
            openedByStaffUserId: context.staffUserId,
            assignedStaffUserId,
            guestCount: 1,
            isCounter: true,
            ticketNumber,
            customerLabel: dto.customerLabel || null,
          },
        });

        const createdBill = await tx.bill.create({
          data: {
            tableSessionId: createdSession.id,
            branchId: dto.branchId,
            number: await allocateBillNumber(tx, dto.branchId),
            status: BillStatus.OPEN,
          },
        });

        return { session: createdSession, bill: createdBill };
      });

      return {
        tableSessionId: session.id,
        tableId: session.tableId,
        branchId: session.branchId,
        billId: bill.id,
        ticketNumber: session.ticketNumber!,
        customerLabel: session.customerLabel,
        status: session.status,
        openedByStaffUserId: session.openedByStaffUserId,
        assignedStaffUserId: session.assignedStaffUserId,
        openedAt: session.openedAt.toISOString(),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Otra mesa virtual tomo ese ticket al mismo tiempo. Intenta de nuevo.',
        );
      }
      throw error;
    }
  }

  private async allocateTicket(
    tx: Prisma.TransactionClient,
    tableId: string,
    branchId: string,
  ): Promise<number> {
    const bump = async () => {
      const rows = await tx.$queryRaw<{ counter_last_ticket: number }[]>`
        UPDATE "tables"
        SET "counter_last_ticket" = "counter_last_ticket" % ${COUNTER_TICKET_MAX} + 1
        WHERE "id" = ${tableId}::uuid
        RETURNING "counter_last_ticket"`;
      return rows[0].counter_last_ticket;
    };

    let candidate = await bump();
    const active = await tx.tableSession.findMany({
      where: {
        branchId,
        isCounter: true,
        status: { in: ACTIVE_TABLE_SESSION_STATUSES },
      },
      select: { ticketNumber: true },
    });
    const taken = new Set(active.map((session) => session.ticketNumber));

    if (taken.size >= COUNTER_TICKET_MAX) {
      throw new ConflictException(ALL_TICKETS_TAKEN_MESSAGE);
    }

    for (let i = 0; i < COUNTER_TICKET_MAX && taken.has(candidate); i++) {
      candidate = await bump();
    }

    if (taken.has(candidate)) {
      throw new ConflictException(ALL_TICKETS_TAKEN_MESSAGE);
    }

    return candidate;
  }
}
