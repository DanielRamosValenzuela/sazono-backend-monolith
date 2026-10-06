import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';
import { PaymentGatewayRegistry } from '../infrastructure/payment-gateway-registry.service';
import type { BillSplitParticipantDetailResponseDto } from '../presentation/http/dto/payments.dto';
import { buildPaymentOptions } from './build-payment-options';

@Injectable()
export class GetBillSplitParticipantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restaurantPaymentAccountRepository: RestaurantPaymentAccountRepository,
    private readonly paymentGatewayRegistry: PaymentGatewayRegistry,
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

    const connectedAccounts =
      await this.restaurantPaymentAccountRepository.findConnectedByRestaurant(
        bill.branch.restaurantId,
      );

    return {
      participantId: participant.id,
      displayName: participant.displayName,
      allocatedAmount: participant.allocatedAmount.toString(),
      paidAmount: participant.paidAmount.toString(),
      status: participant.status,
      currency: bill.branch.restaurant.currency,
      billStatus: bill.status,
      options: buildPaymentOptions(
        connectedAccounts,
        this.paymentGatewayRegistry,
      ),
    };
  }
}
