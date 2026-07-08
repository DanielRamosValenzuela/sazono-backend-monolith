import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { PaymentsBranchAccessService } from './payments-branch-access.service';
import { SettleBillPaymentService } from './settle-bill-payment.service';
import type {
  PayBillDto,
  PaymentResultResponseDto,
} from '../presentation/http/dto/payments.dto';

@Injectable()
export class PayBillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsBranchAccessService: PaymentsBranchAccessService,
    private readonly settleBillPaymentService: SettleBillPaymentService,
  ) {}
  async execute(
    authUser: JwtPayload,
    billId: string,
    dto: PayBillDto,
  ): Promise<PaymentResultResponseDto> {
    const bill = await this.prisma.bill.findUnique({
      where: {
        id: billId,
      },
      include: {
        branch: {
          include: {
            restaurant: true,
          },
        },
      },
    });

    if (!bill) {
      throw new BadRequestException('La cuenta indicada no existe.');
    }

    await this.paymentsBranchAccessService.ensureAccess(
      authUser,
      bill.branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.CASHIER],
    );

    return this.settleBillPaymentService.execute(
      {
        id: bill.id,
        status: bill.status,
        remainingAmount: bill.remainingAmount,
        currency: bill.branch.restaurant.currency,
      },
      new Prisma.Decimal(dto.amount),
      new Prisma.Decimal(dto.tipAmount ?? 0),
    );
  }
}
