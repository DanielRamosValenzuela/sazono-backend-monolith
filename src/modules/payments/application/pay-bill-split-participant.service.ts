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
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { applyPaymentToBill } from './apply-payment-to-bill';
import {
  PAYMENT_PROVIDER,
  type PaymentProviderPort,
} from './ports/payment-provider.port';
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
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProviderPort,
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
      currency: bill.branch.restaurant.currency,
      description: `Split bill participante ${participant.id}`,
    });

    if (!chargeResult.approved) {
      await this.prisma.$transaction([
        this.prisma.paymentAttempt.update({
          where: {
            id: attempt.id,
          },
          data: {
            status: PaymentAttemptStatus.FAILED,
            providerReference: chargeResult.providerReference ?? null,
            failureReason:
              chargeResult.failureReason ?? 'Pago rechazado por el proveedor.',
          },
        }),
        this.prisma.billSplitParticipant.update({
          where: {
            id: participant.id,
          },
          data: {
            status: BillSplitParticipantStatus.FAILED,
          },
        }),
      ]);

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
          billSplitParticipantId: participant.id,
          amount: paidAmount,
          currency: bill.branch.restaurant.currency,
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
