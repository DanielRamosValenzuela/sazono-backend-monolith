import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillSplitStatus, Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../../floor/domain/active-table-session-statuses';
import { BILL_SPLIT_INCLUDE, mapBillSplit } from './bill-split-mapper';
import { PaymentsBranchAccessService } from './payments-branch-access.service';
import type { BillSplitResponseDto } from '../presentation/http/dto/payments.dto';

const ACTIVE_SPLIT_STATUSES: BillSplitStatus[] = [
  BillSplitStatus.OPEN,
  BillSplitStatus.PARTIALLY_PAID,
];

@Injectable()
export class GetCurrentBillSplitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsBranchAccessService: PaymentsBranchAccessService,
  ) {}

  async executeForStaff(
    authUser: JwtPayload,
    billId: string,
  ): Promise<BillSplitResponseDto | null> {
    const bill = await this.prisma.bill.findUnique({
      where: {
        id: billId,
      },
    });

    if (!bill) {
      throw new BadRequestException('La cuenta indicada no existe.');
    }

    await this.paymentsBranchAccessService.ensureAccess(
      authUser,
      bill.branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.CASHIER, Role.WAITER],
    );

    return this.findActiveSplit(bill.id);
  }

  async executeForQrToken(
    qrToken: string,
  ): Promise<BillSplitResponseDto | null> {
    const table = await this.prisma.table.findUnique({
      where: {
        qrToken,
      },
    });

    if (!table) {
      throw new NotFoundException('El QR indicado no esta disponible.');
    }

    const activeSession = await this.prisma.tableSession.findFirst({
      where: {
        tableId: table.id,
        status: {
          in: ACTIVE_TABLE_SESSION_STATUSES,
        },
      },
      include: {
        bill: true,
      },
    });

    if (!activeSession?.bill) {
      return null;
    }

    return this.findActiveSplit(activeSession.bill.id);
  }

  private async findActiveSplit(
    billId: string,
  ): Promise<BillSplitResponseDto | null> {
    const split = await this.prisma.billSplit.findFirst({
      where: {
        billId,
        status: {
          in: ACTIVE_SPLIT_STATUSES,
        },
      },
      include: BILL_SPLIT_INCLUDE,
    });

    return split ? mapBillSplit(split) : null;
  }
}
