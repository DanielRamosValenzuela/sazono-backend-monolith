import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentAccountStatus, PaymentGatewayProvider } from '@prisma/client';
import { SetPreferredPaymentAccountService } from './set-preferred-payment-account.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';

describe('SetPreferredPaymentAccountService', () => {
  const getStaffContextMock = jest.fn();
  const branchAccessService = {
    getStaffContext: getStaffContextMock,
  } as unknown as BranchAccessService;

  const setPreferredMock = jest.fn();
  const findByRestaurantAndProviderMock = jest.fn();
  const restaurantPaymentAccountRepository = {
    setPreferred: setPreferredMock,
    findByRestaurantAndProvider: findByRestaurantAndProviderMock,
  } as unknown as RestaurantPaymentAccountRepository;

  let service: SetPreferredPaymentAccountService;

  const authUser = {} as JwtPayload;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SetPreferredPaymentAccountService(
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

    await expect(
      service.execute(authUser, PaymentGatewayProvider.MERCADO_PAGO),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(setPreferredMock).not.toHaveBeenCalled();
  });

  it('throws when no account exists for that provider on this restaurant', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      memberBranchIds: new Set(['branch-1']),
      adminBranchIds: new Set(['branch-1']),
    });
    setPreferredMock.mockResolvedValue(0);

    await expect(
      service.execute(authUser, PaymentGatewayProvider.MERCADO_PAGO),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('raises the account priority above the others and returns its updated status', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      memberBranchIds: new Set(['branch-1']),
      adminBranchIds: new Set(['branch-1']),
    });
    setPreferredMock.mockResolvedValue(1);
    findByRestaurantAndProviderMock.mockResolvedValue({
      provider: PaymentGatewayProvider.MERCADO_PAGO,
      status: PaymentAccountStatus.CONNECTED,
      environment: 'sandbox',
      displayPriority: 11,
      externalAccountId: null,
      publicKey: 'public-key-1',
      liveMode: false,
      scope: null,
      connectedAt: new Date('2026-07-27T12:00:00.000Z'),
      accessTokenExpiresAt: null,
      lastErrorMessage: null,
    });

    const result = await service.execute(
      authUser,
      PaymentGatewayProvider.MERCADO_PAGO,
    );

    expect(setPreferredMock).toHaveBeenCalledWith(
      'restaurant-1',
      PaymentGatewayProvider.MERCADO_PAGO,
    );
    expect(result.displayPriority).toBe(11);
  });
});
