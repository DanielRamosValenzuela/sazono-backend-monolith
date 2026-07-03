import { BadRequestException, Injectable } from '@nestjs/common';
import { BillStatus, Role, TableSessionStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type { BillResponseDto } from '../presentation/http/dto/billing.dto';
import { BillingBranchAccessService } from './billing-branch-access.service';

@Injectable()
export class GetCurrentBillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingBranchAccessService: BillingBranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    tableSessionId: string,
  ): Promise<BillResponseDto> {
    const tableSession = await this.prisma.tableSession.findUnique({
      where: {
        id: tableSessionId,
      },
      include: {
        bill: true,
      },
    });

    if (!tableSession) {
      throw new BadRequestException('La sesion indicada no existe.');
    }

    await this.billingBranchAccessService.ensureAccess(
      authUser,
      tableSession.branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.WAITER, Role.CASHIER],
    );

    const bill =
      tableSession.bill ??
      (tableSession.status === TableSessionStatus.CLOSED ||
      tableSession.status === TableSessionStatus.ABANDONED
        ? null
        : await this.prisma.bill.create({
            data: {
              tableSessionId: tableSession.id,
              branchId: tableSession.branchId,
              status: BillStatus.OPEN,
            },
          }));

    if (!bill) {
      throw new BadRequestException(
        'La sesion indicada no tiene una cuenta operativa disponible.',
      );
    }

    return {
      billId: bill.id,
      tableSessionId: bill.tableSessionId,
      branchId: bill.branchId,
      status: bill.status,
      subtotalAmount: bill.subtotalAmount.toString(),
      taxAmount: bill.taxAmount.toString(),
      tipAmount: bill.tipAmount.toString(),
      totalAmount: bill.totalAmount.toString(),
      remainingAmount: bill.remainingAmount.toString(),
      openedAt: bill.openedAt.toISOString(),
      closedAt: bill.closedAt?.toISOString() ?? null,
      closeReason: bill.closeReason,
    };
  }
}
