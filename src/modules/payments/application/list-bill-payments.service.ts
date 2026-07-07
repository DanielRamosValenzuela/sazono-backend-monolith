import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { PaymentsBranchAccessService } from './payments-branch-access.service';
import type { PaymentSummaryResponseDto } from '../presentation/http/dto/payments.dto';

@Injectable()
export class ListBillPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsBranchAccessService: PaymentsBranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    billId: string,
  ): Promise<PaymentSummaryResponseDto[]> {
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
      [Role.ADMIN, Role.SUPERVISOR, Role.WAITER, Role.CASHIER],
    );

    const payments = await this.prisma.payment.findMany({
      where: {
        billId: bill.id,
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    return payments.map((payment) => ({
      paymentId: payment.id,
      billId: payment.billId,
      amount: payment.amount.toString(),
      currency: payment.currency,
      provider: payment.provider,
      providerReference: payment.providerReference,
      status: payment.status,
      paidAt: payment.paidAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
    }));
  }
}
