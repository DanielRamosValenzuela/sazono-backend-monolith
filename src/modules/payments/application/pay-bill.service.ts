import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PaymentMethod, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { PaymentChannel } from '../domain/payment-channel';
import { PaymentSource } from './finalize-payment.service';
import { SettleBillPaymentService } from './settle-bill-payment.service';
import type {
  PayStaffBillDto,
  PaymentResultResponseDto,
} from '../presentation/http/dto/payments.dto';

const STAFF_PAY_ROLES: Role[] = [Role.ADMIN, Role.SUPERVISOR, Role.CASHIER];

@Injectable()
export class PayBillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
    private readonly settleBillPaymentService: SettleBillPaymentService,
  ) {}
  async execute(
    authUser: JwtPayload,
    billId: string,
    dto: PayStaffBillDto,
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
        tableSession: {
          select: { isCounter: true },
        },
      },
    });

    if (!bill) {
      throw new BadRequestException('La cuenta indicada no existe.');
    }

    const context = await this.branchAccessService.ensureAccess(
      authUser,
      bill.branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.WAITER, Role.CASHIER],
    );

    if (
      !bill.tableSession.isCounter &&
      !context.roles.some((role) => STAFF_PAY_ROLES.includes(role))
    ) {
      throw new ForbiddenException(
        'Solo caja, supervisor o admin puede cobrar una cuenta de mesa.',
      );
    }

    return this.settleBillPaymentService.execute(
      PaymentChannel.STAFF_OFFLINE,
      {
        id: bill.id,
        status: bill.status,
        remainingAmount: bill.remainingAmount,
        currency: bill.branch.restaurant.currency,
        restaurantId: bill.branch.restaurantId,
      },
      new Prisma.Decimal(dto.amount),
      new Prisma.Decimal(dto.tipAmount ?? 0),
      undefined,
      {
        staffUserId: context.staffUserId,
        source: context.roles.some((role) => STAFF_PAY_ROLES.includes(role))
          ? PaymentSource.CASHIER
          : PaymentSource.WAITER,
        method: dto.paymentMethod ?? PaymentMethod.CASH,
      },
    );
  }
}
