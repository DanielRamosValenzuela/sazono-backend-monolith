import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillSplitParticipantStatus,
  BillStatus,
  PaymentAttemptStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { applyPaymentToBill } from './apply-payment-to-bill';
import { buildCheckoutFromDto } from './build-checkout-from-dto';
import { ChargePaymentService } from './charge-payment.service';
import { PaymentChannel } from '../domain/payment-channel';
import { FailPaymentService } from './fail-payment.service';
import { FinalizePaymentService } from './finalize-payment.service';
import { mapPaymentResult } from './payment-result-mapper';
import {
  OFFLINE_PAYMENT_RECORDER,
  type OfflinePaymentRecorderPort,
} from './ports/offline-payment-recorder.port';
import { updateBillSplitStatus } from './update-bill-split-status';
import type {
  PayBillSplitParticipantDto,
  PaymentResultResponseDto,
} from '../presentation/http/dto/payments.dto';

const PAYABLE_PARTICIPANT_STATUSES: BillSplitParticipantStatus[] = [
  BillSplitParticipantStatus.PENDING,
  BillSplitParticipantStatus.PARTIALLY_PAID,
  BillSplitParticipantStatus.FAILED,
];

@Injectable()
export class PayBillSplitParticipantService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OFFLINE_PAYMENT_RECORDER)
    private readonly offlinePaymentRecorder: OfflinePaymentRecorderPort,
    private readonly chargePaymentService: ChargePaymentService,
    private readonly finalizePaymentService: FinalizePaymentService,
    private readonly failPaymentService: FailPaymentService,
  ) {}
  async execute(
    participantToken: string,
    dto: PayBillSplitParticipantDto,
  ): Promise<PaymentResultResponseDto> {
    const participant = await this.prisma.billSplitParticipant.findFirst({
      where: {
        participantToken,
      },
      include: {
        billSplit: {
          include: {
            bill: {
              include: {
                branch: {
                  include: {
                    restaurant: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!participant) {
      throw new NotFoundException(
        'El participante del split indicado no existe.',
      );
    }

    const bill = participant.billSplit.bill;

    if (
      bill.status !== BillStatus.OPEN &&
      bill.status !== BillStatus.PARTIALLY_PAID
    ) {
      throw new ConflictException(
        'La cuenta asociada al split ya no admite pagos.',
      );
    }

    if (!PAYABLE_PARTICIPANT_STATUSES.includes(participant.status)) {
      throw new ConflictException(
        'Este participante ya completo su pago o fue cancelado.',
      );
    }

    const tipDelta = new Prisma.Decimal(dto.tipAmount ?? 0);

    if (tipDelta.lt(0)) {
      throw new BadRequestException('La propina no puede ser negativa.');
    }

    const allocationRemaining = participant.allocatedAmount.sub(
      participant.paidAmount,
    );

    if (allocationRemaining.lte(0)) {
      throw new ConflictException(
        'Este participante no tiene saldo pendiente.',
      );
    }

    const paidAmount = allocationRemaining.add(tipDelta);
    const currency = bill.branch.restaurant.currency;
    const checkout = buildCheckoutFromDto(dto);

    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        billId: bill.id,
        amount: paidAmount,
        provider: this.offlinePaymentRecorder.providerName,
        status: PaymentAttemptStatus.PENDING,
      },
    });

    const chargeResult = await this.chargePaymentService.execute({
      channel: PaymentChannel.QR_ONLINE,
      restaurantId: bill.branch.restaurantId,
      attemptId: attempt.id,
      amount: paidAmount,
      currency,
      description: `Split bill participante ${participant.id}`,
      checkout,
    });

    if (!chargeResult.approved) {
      await this.prisma.$transaction(async (tx) => {
        await this.failPaymentService.execute(tx, {
          attemptId: attempt.id,
          providerReference: chargeResult.providerReference,
          failureReason:
            chargeResult.failureReason ?? 'Pago rechazado por el proveedor.',
        });

        await tx.billSplitParticipant.update({
          where: {
            id: participant.id,
          },
          data: {
            status: BillSplitParticipantStatus.FAILED,
          },
        });
      });

      throw new ConflictException(
        'El pago fue rechazado por el proveedor. Puedes reintentarlo.',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await this.finalizePaymentService.execute(tx, {
        attemptId: attempt.id,
        billId: bill.id,
        billSplitParticipantId: participant.id,
        amount: paidAmount,
        currency,
        provider: chargeResult.providerName,
        providerReference: chargeResult.providerReference,
      });

      const billAfterPayment = await applyPaymentToBill(
        tx,
        bill.id,
        paidAmount,
        tipDelta,
      );

      const newPaidAmount = participant.paidAmount.add(allocationRemaining);
      const participantStatus = newPaidAmount.gte(participant.allocatedAmount)
        ? BillSplitParticipantStatus.PAID
        : BillSplitParticipantStatus.PARTIALLY_PAID;

      await tx.billSplitParticipant.update({
        where: {
          id: participant.id,
        },
        data: {
          paidAmount: newPaidAmount,
          status: participantStatus,
        },
      });

      await updateBillSplitStatus(tx, participant.billSplitId);

      return { payment, billAfterPayment };
    });

    return mapPaymentResult(result.payment, result.billAfterPayment, null);
  }
}
