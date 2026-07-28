import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { PaymentGatewayProvider } from '@prisma/client';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';
import { mapPaymentAccountToStatusResponse } from './payment-account-mapper';
import type { PaymentAccountStatusResponseDto } from '../presentation/http/dto/payment-accounts.dto';

@Injectable()
export class ResumePaymentAccountService {
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
        'Debes tener al menos un rol ADMIN para reanudar una pasarela de pago.',
      );
    }

    const resumedCount = await this.restaurantPaymentAccountRepository.resume(
      context.restaurantId,
      provider,
    );

    if (resumedCount === 0) {
      throw new ConflictException(
        'La cuenta indicada no esta pausada, no se puede reanudar.',
      );
    }

    const account =
      await this.restaurantPaymentAccountRepository.findByRestaurantAndProvider(
        context.restaurantId,
        provider,
      );

    if (!account) {
      throw new ConflictException('La cuenta indicada ya no existe.');
    }

    return mapPaymentAccountToStatusResponse(account);
  }
}
