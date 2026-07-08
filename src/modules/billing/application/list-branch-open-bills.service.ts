import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../../floor/domain/active-table-session-statuses';
import { BillingBranchAccessService } from './billing-branch-access.service';
import type { BranchOpenBillResponseDto } from '../presentation/http/dto/billing.dto';

@Injectable()
export class ListBranchOpenBillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingBranchAccessService: BillingBranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    branchId: string,
  ): Promise<BranchOpenBillResponseDto[]> {
    await this.billingBranchAccessService.ensureAccess(authUser, branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
      Role.WAITER,
      Role.CASHIER,
    ]);

    const sessions = await this.prisma.tableSession.findMany({
      where: {
        branchId,
        status: {
          in: ACTIVE_TABLE_SESSION_STATUSES,
        },
      },
      include: {
        table: true,
        bill: true,
      },
      orderBy: [{ openedAt: 'asc' }],
    });

    return sessions
      .filter((session) => session.bill !== null)
      .map((session) => ({
        tableId: session.table.id,
        tableCode: session.table.code,
        tableName: session.table.name,
        tableSessionId: session.id,
        sessionStatus: session.status,
        sessionOpenedAt: session.openedAt.toISOString(),
        billId: session.bill!.id,
        totalAmount: session.bill!.totalAmount.toString(),
        remainingAmount: session.bill!.remainingAmount.toString(),
      }));
  }
}
