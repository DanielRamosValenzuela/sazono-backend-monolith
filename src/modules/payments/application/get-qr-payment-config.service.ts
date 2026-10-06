import { Injectable, NotFoundException } from '@nestjs/common';
import { TableStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';
import { PaymentGatewayRegistry } from '../infrastructure/payment-gateway-registry.service';
import type { QrPaymentConfigResponseDto } from '../presentation/http/dto/payments.dto';
import { buildPaymentOptions } from './build-payment-options';

@Injectable()
export class GetQrPaymentConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restaurantPaymentAccountRepository: RestaurantPaymentAccountRepository,
    private readonly paymentGatewayRegistry: PaymentGatewayRegistry,
  ) {}

  async execute(qrToken: string): Promise<QrPaymentConfigResponseDto> {
    const table = await this.prisma.table.findUnique({
      where: {
        qrToken,
      },
      include: {
        branch: true,
      },
    });

    if (!table || table.status === TableStatus.DISABLED) {
      throw new NotFoundException('El QR indicado no esta disponible.');
    }

    const connectedAccounts =
      await this.restaurantPaymentAccountRepository.findConnectedByRestaurant(
        table.branch.restaurantId,
      );

    return {
      options: buildPaymentOptions(
        connectedAccounts,
        this.paymentGatewayRegistry,
      ),
    };
  }
}
