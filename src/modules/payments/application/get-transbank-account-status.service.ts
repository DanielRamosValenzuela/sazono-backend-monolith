import { Injectable } from '@nestjs/common';
import { PaymentGatewayProvider } from '@prisma/client';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';
import { mapPaymentAccountToStatusResponse } from './payment-account-mapper';
import type { PaymentAccountStatusResponseDto } from '../presentation/http/dto/payment-accounts.dto';

@Injectable()
export class GetTransbankAccountStatusService {
  constructor(
    private readonly branchAccessService: BranchAccessService,
    private readonly restaurantPaymentAccountRepository: RestaurantPaymentAccountRepository,
  ) {}

  async execute(
    authUser: JwtPayload,
  ): Promise<PaymentAccountStatusResponseDto | null> {
    const context = await this.branchAccessService.getStaffContext(authUser);

    const account =
      await this.restaurantPaymentAccountRepository.findByRestaurantAndProvider(
        context.restaurantId,
        PaymentGatewayProvider.TRANSBANK,
      );

    if (!account) {
      return null;
    }

    return mapPaymentAccountToStatusResponse(account);
  }
}
