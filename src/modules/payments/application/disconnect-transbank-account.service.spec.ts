import { ForbiddenException } from '@nestjs/common';
import { PaymentGatewayProvider } from '@prisma/client';
import { DisconnectTransbankAccountService } from './disconnect-transbank-account.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';

describe('DisconnectTransbankAccountService', () => {
  const getStaffContextMock = jest.fn();
  const branchAccessService = {
    getStaffContext: getStaffContextMock,
  } as unknown as BranchAccessService;

  const markManualDisconnectedMock = jest.fn();
  const restaurantPaymentAccountRepository = {
    markManualDisconnected: markManualDisconnectedMock,
  } as unknown as RestaurantPaymentAccountRepository;

  let service: DisconnectTransbankAccountService;

  const authUser = {} as JwtPayload;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DisconnectTransbankAccountService(
      branchAccessService,
      restaurantPaymentAccountRepository,
    );
  });

  it('rejects a staff member without an ADMIN role', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      memberBranchIds: new Set(['branch-1']),
      adminBranchIds: new Set(),
    });

    await expect(service.execute(authUser)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(markManualDisconnectedMock).not.toHaveBeenCalled();
  });

  it('disconnects the Transbank account of the authenticated restaurant', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      memberBranchIds: new Set(['branch-1']),
      adminBranchIds: new Set(['branch-1']),
    });
    markManualDisconnectedMock.mockResolvedValue(1);

    await service.execute(authUser);

    expect(markManualDisconnectedMock).toHaveBeenCalledWith(
      'restaurant-1',
      PaymentGatewayProvider.TRANSBANK,
    );
  });
});
