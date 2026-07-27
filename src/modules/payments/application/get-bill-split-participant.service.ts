import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentAccountStatus, PaymentGatewayProvider } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';
import type { BillSplitParticipantDetailResponseDto } from '../presentation/http/dto/payments.dto';

@Injectable()
export class GetBillSplitParticipantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restaurantPaymentAccountRepository: RestaurantPaymentAccountRepository,
  ) {}

  async execute(
    participantToken: string,
  ): Promise<BillSplitParticipantDetailResponseDto> {
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

    const participantDetail = {
      participantId: participant.id,
      displayName: participant.displayName,
      allocatedAmount: participant.allocatedAmount.toString(),
      paidAmount: participant.paidAmount.toString(),
      status: participant.status,
      currency: bill.branch.restaurant.currency,
      billStatus: bill.status,
    };

    const account =
      await this.restaurantPaymentAccountRepository.findByRestaurant(
        bill.branch.restaurantId,
      );

    if (
      account &&
      account.status === PaymentAccountStatus.CONNECTED &&
      account.publicKey
    ) {
      return {
        ...participantDetail,
        gatewayConnected: true,
        provider: PaymentGatewayProvider.MERCADO_PAGO,
        publicKey: account.publicKey,
        environment: account.environment,
      };
    }

    return {
      ...participantDetail,
      gatewayConnected: false,
    };
  }
}
