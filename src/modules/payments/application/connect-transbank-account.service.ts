import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PaymentGatewayProvider } from '@prisma/client';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';
import { TransbankConfigService } from '../infrastructure/transbank/transbank-config.service';
import { mapPaymentAccountToStatusResponse } from './payment-account-mapper';
import type {
  ConnectTransbankAccountDto,
  PaymentAccountStatusResponseDto,
} from '../presentation/http/dto/payment-accounts.dto';

@Injectable()
export class ConnectTransbankAccountService {
  constructor(
    private readonly branchAccessService: BranchAccessService,
    private readonly restaurantPaymentAccountRepository: RestaurantPaymentAccountRepository,
    private readonly transbankConfig: TransbankConfigService,
  ) {}

  async execute(
    authUser: JwtPayload,
    dto: ConnectTransbankAccountDto,
  ): Promise<PaymentAccountStatusResponseDto> {
    if (!this.transbankConfig.isEnabled) {
      throw new ServiceUnavailableException(
        'Transbank Webpay no esta habilitado en este ambiente.',
      );
    }

    const context = await this.branchAccessService.getStaffContext(authUser);

    if (context.adminBranchIds.size === 0) {
      throw new ForbiddenException(
        'Debes tener al menos un rol ADMIN para conectar una pasarela de pago.',
      );
    }

    const account =
      await this.restaurantPaymentAccountRepository.upsertManualConnection(
        context.restaurantId,
        PaymentGatewayProvider.TRANSBANK,
        {
          environment: dto.environment ?? this.transbankConfig.environment,
          childCommerceCode: dto.childCommerceCode,
        },
      );

    return mapPaymentAccountToStatusResponse(account);
  }
}
