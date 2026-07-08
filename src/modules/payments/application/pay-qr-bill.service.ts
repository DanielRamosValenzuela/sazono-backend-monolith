import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TableStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../../floor/domain/active-table-session-statuses';
import { SettleBillPaymentService } from './settle-bill-payment.service';
import type {
  PayBillDto,
  PaymentResultResponseDto,
} from '../presentation/http/dto/payments.dto';

@Injectable()
export class PayQrBillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settleBillPaymentService: SettleBillPaymentService,
  ) {}
  async execute(
    qrToken: string,
    dto: PayBillDto,
  ): Promise<PaymentResultResponseDto> {
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
        branch: {
          include: {
            restaurant: true,
          },
        },
      },
    });

    if (!activeSession?.bill) {
      throw new NotFoundException(
        'La mesa no tiene una cuenta abierta para pagar.',
      );
    }

    return this.settleBillPaymentService.execute(
      {
        id: activeSession.bill.id,
        status: activeSession.bill.status,
        remainingAmount: activeSession.bill.remainingAmount,
        currency: activeSession.branch.restaurant.currency,
      },
      new Prisma.Decimal(dto.amount),
      new Prisma.Decimal(dto.tipAmount ?? 0),
    );
  }
}
