import { Injectable } from '@nestjs/common';
import { PaymentGatewayProvider } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { mapPaymentAccountToStatusResponse } from './payment-account-mapper';
import type { PaymentAccountStatusResponseDto } from '../presentation/http/dto/payment-accounts.dto';

@Injectable()
export class GetPaymentAccountStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
  ): Promise<PaymentAccountStatusResponseDto | null> {
    const context = await this.branchAccessService.getStaffContext(authUser);

    const account = await this.prisma.restaurantPaymentAccount.findUnique({
      where: {
        restaurantId_provider: {
          restaurantId: context.restaurantId,
          provider: PaymentGatewayProvider.MERCADO_PAGO,
        },
      },
    });

    if (!account) {
      return null;
    }

    return mapPaymentAccountToStatusResponse(account);
  }
}
