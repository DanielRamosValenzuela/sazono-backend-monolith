import { Injectable, NotFoundException } from '@nestjs/common';
import { TableStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../../floor/domain/active-table-session-statuses';
import type { BillSummaryResponseDto } from '../presentation/http/dto/payments.dto';

@Injectable()
export class GetQrBillService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(qrToken: string): Promise<BillSummaryResponseDto | null> {
    const table = await this.prisma.table.findUnique({
      where: {
        qrToken,
      },
    });

    if (!table || table.status === TableStatus.DISABLED) {
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

    const bill = activeSession.bill;

    return {
      billId: bill.id,
      status: bill.status,
      subtotalAmount: bill.subtotalAmount.toString(),
      tipAmount: bill.tipAmount.toString(),
      totalAmount: bill.totalAmount.toString(),
      remainingAmount: bill.remainingAmount.toString(),
    };
  }
}
