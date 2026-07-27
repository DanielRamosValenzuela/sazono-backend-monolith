import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PaymentAccountStatus,
  PaymentGatewayProvider,
  TableStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';
import type { QrPaymentConfigResponseDto } from '../presentation/http/dto/payments.dto';

@Injectable()
export class GetQrPaymentConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restaurantPaymentAccountRepository: RestaurantPaymentAccountRepository,
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

    const account =
      await this.restaurantPaymentAccountRepository.findByRestaurant(
        table.branch.restaurantId,
      );

    if (
      !account ||
      account.status !== PaymentAccountStatus.CONNECTED ||
      !account.publicKey
    ) {
      return { gatewayConnected: false };
    }

    return {
      gatewayConnected: true,
      provider: PaymentGatewayProvider.MERCADO_PAGO,
      publicKey: account.publicKey,
      environment: account.environment,
    };
  }
}
