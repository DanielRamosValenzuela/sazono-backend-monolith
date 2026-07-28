import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PaymentAccountStatus, PaymentGatewayProvider } from '@prisma/client';
import { PausePaymentAccountService } from './pause-payment-account.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';

describe('PausePaymentAccountService', () => {
  const getStaffContextMock = jest.fn();
  const branchAccessService = {
    getStaffContext: getStaffContextMock,
  } as unknown as BranchAccessService;

  const pauseMock = jest.fn();
  const findByRestaurantAndProviderMock = jest.fn();
  const restaurantPaymentAccountRepository = {
    pause: pauseMock,
    findByRestaurantAndProvider: findByRestaurantAndProviderMock,
  } as unknown as RestaurantPaymentAccountRepository;

  let service: PausePaymentAccountService;

  const authUser = {} as JwtPayload;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PausePaymentAccountService(
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
    expect(pauseMock).not.toHaveBeenCalled();
  });

  it('throws when there is no CONNECTED account to pause', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      memberBranchIds: new Set(['branch-1']),
      adminBranchIds: new Set(['branch-1']),
    });
    pauseMock.mockResolvedValue(0);

    await expect(
      service.execute(authUser, PaymentGatewayProvider.MERCADO_PAGO),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(findByRestaurantAndProviderMock).not.toHaveBeenCalled();
  });

  it('pauses the account and returns its updated status', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      memberBranchIds: new Set(['branch-1']),
      adminBranchIds: new Set(['branch-1']),
    });
    pauseMock.mockResolvedValue(1);
    findByRestaurantAndProviderMock.mockResolvedValue({
      provider: PaymentGatewayProvider.MERCADO_PAGO,
      status: PaymentAccountStatus.PAUSED,
      environment: 'sandbox',
      displayPriority: 0,
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

    expect(pauseMock).toHaveBeenCalledWith(
      'restaurant-1',
      PaymentGatewayProvider.MERCADO_PAGO,
    );
    expect(result.status).toBe(PaymentAccountStatus.PAUSED);
  });
});
