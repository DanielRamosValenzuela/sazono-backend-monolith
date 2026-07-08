import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  BillStatus,
  PaymentAttemptStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { applyPaymentToBill } from './apply-payment-to-bill';
import {
  PAYMENT_PROVIDER,
  type PaymentProviderPort,
} from './ports/payment-provider.port';
import type { PaymentResultResponseDto } from '../presentation/http/dto/payments.dto';

const PAYABLE_BILL_STATUSES: BillStatus[] = [
  BillStatus.OPEN,
  BillStatus.PARTIALLY_PAID,
];

type PayableBill = {
  id: string;
  status: BillStatus;
  remainingAmount: Prisma.Decimal;
  currency: string;
};
@Injectable()
export class SettleBillPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProviderPort,
  ) {}

  async execute(
    bill: PayableBill,
    amount: Prisma.Decimal,
    tipDelta: Prisma.Decimal,
  ): Promise<PaymentResultResponseDto> {
    if (!PAYABLE_BILL_STATUSES.includes(bill.status)) {
      throw new ConflictException(
        'La cuenta indicada no admite pagos en su estado actual.',
      );
    }

    if (amount.lte(0)) {
      throw new BadRequestException('El monto a pagar debe ser mayor a cero.');
    }

    if (tipDelta.lt(0)) {
      throw new BadRequestException('La propina no puede ser negativa.');
    }

    if (amount.gt(bill.remainingAmount)) {
      throw new BadRequestException(
        'El monto pagado supera el saldo pendiente de la cuenta.',
      );
    }

    const paidAmount = amount.add(tipDelta);

    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        billId: bill.id,
        amount: paidAmount,
        provider: this.paymentProvider.providerName,
        status: PaymentAttemptStatus.PENDING,
      },
    });

    const chargeResult = await this.paymentProvider.charge({
      amount: paidAmount,
      currency: bill.currency,
      description: `Pago de cuenta ${bill.id}`,
    });

    if (!chargeResult.approved) {
      await this.prisma.paymentAttempt.update({
        where: {
          id: attempt.id,
        },
        data: {
          status: PaymentAttemptStatus.FAILED,
          providerReference: chargeResult.providerReference ?? null,
          failureReason:
            chargeResult.failureReason ?? 'Pago rechazado por el proveedor.',
        },
      });

      throw new ConflictException(
        'El pago fue rechazado por el proveedor. Puedes reintentarlo.',
      );
    }

    const paidAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.paymentAttempt.update({
        where: {
          id: attempt.id,
        },
        data: {
          status: PaymentAttemptStatus.SUCCEEDED,
          providerReference: chargeResult.providerReference ?? null,
        },
      });

      const payment = await tx.payment.create({
        data: {
          billId: bill.id,
          amount: paidAmount,
          currency: bill.currency,
          provider: this.paymentProvider.providerName,
          providerReference: chargeResult.providerReference ?? null,
          status: PaymentStatus.PAID,
          paidAt,
        },
      });

      const billAfterPayment = await applyPaymentToBill(
        tx,
        bill.id,
        paidAmount,
        tipDelta,
      );

      return { payment, billAfterPayment };
    });

    return {
      paymentId: result.payment.id,
      billId: result.payment.billId,
      amount: result.payment.amount.toString(),
      currency: result.payment.currency,
      provider: result.payment.provider,
      providerReference: result.payment.providerReference,
      status: result.payment.status,
      paidAt: result.payment.paidAt?.toISOString() ?? null,
      bill: {
        billId: result.billAfterPayment.billId,
        status: result.billAfterPayment.status,
        subtotalAmount: result.billAfterPayment.subtotalAmount.toString(),
        tipAmount: result.billAfterPayment.tipAmount.toString(),
        totalAmount: result.billAfterPayment.totalAmount.toString(),
        remainingAmount: result.billAfterPayment.remainingAmount.toString(),
      },
      order: null,
    };
  }
}
