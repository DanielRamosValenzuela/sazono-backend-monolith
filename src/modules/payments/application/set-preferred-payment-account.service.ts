import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PaymentGatewayProvider } from '@prisma/client';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';
import { mapPaymentAccountToStatusResponse } from './payment-account-mapper';
import type { PaymentAccountStatusResponseDto } from '../presentation/http/dto/payment-accounts.dto';

@Injectable()
export class SetPreferredPaymentAccountService {
  constructor(
    private readonly branchAccessService: BranchAccessService,
    private readonly restaurantPaymentAccountRepository: RestaurantPaymentAccountRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
    provider: PaymentGatewayProvider,
  ): Promise<PaymentAccountStatusResponseDto> {
    const context = await this.branchAccessService.getStaffContext(authUser);

    if (context.adminBranchIds.size === 0) {
      throw new ForbiddenException(
        'Debes tener al menos un rol ADMIN para elegir la pasarela preferida.',
      );
    }

    const updatedCount =
      await this.restaurantPaymentAccountRepository.setPreferred(
        context.restaurantId,
        provider,
      );

    if (updatedCount === 0) {
      throw new NotFoundException(
        'No existe una cuenta de esa pasarela para este restaurante.',
      );
    }

    const account =
      await this.restaurantPaymentAccountRepository.findByRestaurantAndProvider(
        context.restaurantId,
        provider,
      );

    if (!account) {
      throw new NotFoundException(
        'No existe una cuenta de esa pasarela para este restaurante.',
      );
    }

    return mapPaymentAccountToStatusResponse(account);
  }
}
