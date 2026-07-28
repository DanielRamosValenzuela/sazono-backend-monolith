import { ForbiddenException, Injectable } from '@nestjs/common';
import { PaymentGatewayProvider } from '@prisma/client';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';

@Injectable()
export class DisconnectTransbankAccountService {
  constructor(
    private readonly branchAccessService: BranchAccessService,
    private readonly restaurantPaymentAccountRepository: RestaurantPaymentAccountRepository,
  ) {}

  async execute(authUser: JwtPayload): Promise<void> {
    const context = await this.branchAccessService.getStaffContext(authUser);

    if (context.adminBranchIds.size === 0) {
      throw new ForbiddenException(
        'Debes tener al menos un rol ADMIN para desconectar una pasarela de pago.',
      );
    }

    await this.restaurantPaymentAccountRepository.markManualDisconnected(
      context.restaurantId,
      PaymentGatewayProvider.TRANSBANK,
    );
  }
}
