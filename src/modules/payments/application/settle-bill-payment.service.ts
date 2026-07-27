import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { BillStatus, PaymentAttemptStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { applyPaymentToBill } from './apply-payment-to-bill';
import {
  ChargePaymentService,
  type ChargePaymentCheckout,
} from './charge-payment.service';
import { FailPaymentService } from './fail-payment.service';
import { FinalizePaymentService } from './finalize-payment.service';
import { mapPaymentResult } from './payment-result-mapper';
import {
  OFFLINE_PAYMENT_RECORDER,
  type OfflinePaymentRecorderPort,
} from './ports/offline-payment-recorder.port';
import type { PaymentChannel } from '../domain/payment-channel';
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
  restaurantId: string;
};
@Injectable()
export class SettleBillPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OFFLINE_PAYMENT_RECORDER)
    private readonly offlinePaymentRecorder: OfflinePaymentRecorderPort,
    private readonly chargePaymentService: ChargePaymentService,
    private readonly finalizePaymentService: FinalizePaymentService,
    private readonly failPaymentService: FailPaymentService,
  ) {}

  async execute(
    channel: PaymentChannel,
    bill: PayableBill,
    amount: Prisma.Decimal,
    tipDelta: Prisma.Decimal,
    checkout?: ChargePaymentCheckout,
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
        provider: this.offlinePaymentRecorder.providerName,
        status: PaymentAttemptStatus.PENDING,
      },
    });

    const chargeResult = await this.chargePaymentService.execute({
      channel,
      restaurantId: bill.restaurantId,
      attemptId: attempt.id,
      amount: paidAmount,
      currency: bill.currency,
      description: `Pago de cuenta ${bill.id}`,
      checkout,
    });

    if (!chargeResult.approved) {
      await this.failPaymentService.execute(this.prisma, {
        attemptId: attempt.id,
        providerReference: chargeResult.providerReference,
        failureReason:
          chargeResult.failureReason ?? 'Pago rechazado por el proveedor.',
      });

      throw new ConflictException(
        'El pago fue rechazado por el proveedor. Puedes reintentarlo.',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await this.finalizePaymentService.execute(tx, {
        attemptId: attempt.id,
        billId: bill.id,
        amount: paidAmount,
        currency: bill.currency,
        provider: chargeResult.providerName,
        providerReference: chargeResult.providerReference,
      });

      const billAfterPayment = await applyPaymentToBill(
        tx,
        bill.id,
        paidAmount,
        tipDelta,
      );

      return { payment, billAfterPayment };
    });

    return mapPaymentResult(result.payment, result.billAfterPayment, null);
  }
}
