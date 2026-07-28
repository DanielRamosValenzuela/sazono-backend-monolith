import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PaymentAccountStatus, PaymentGatewayProvider } from '@prisma/client';
import { ResumePaymentAccountService } from './resume-payment-account.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';

describe('ResumePaymentAccountService', () => {
  const getStaffContextMock = jest.fn();
  const branchAccessService = {
    getStaffContext: getStaffContextMock,
  } as unknown as BranchAccessService;

  const resumeMock = jest.fn();
  const findByRestaurantAndProviderMock = jest.fn();
  const restaurantPaymentAccountRepository = {
    resume: resumeMock,
    findByRestaurantAndProvider: findByRestaurantAndProviderMock,
  } as unknown as RestaurantPaymentAccountRepository;

  let service: ResumePaymentAccountService;

  const authUser = {} as JwtPayload;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ResumePaymentAccountService(
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
    expect(resumeMock).not.toHaveBeenCalled();
  });

  it('throws when there is no PAUSED account to resume', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      memberBranchIds: new Set(['branch-1']),
      adminBranchIds: new Set(['branch-1']),
    });
    resumeMock.mockResolvedValue(0);

    await expect(
      service.execute(authUser, PaymentGatewayProvider.MERCADO_PAGO),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('resumes the account and returns its updated status', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      memberBranchIds: new Set(['branch-1']),
      adminBranchIds: new Set(['branch-1']),
    });
    resumeMock.mockResolvedValue(1);
    findByRestaurantAndProviderMock.mockResolvedValue({
      provider: PaymentGatewayProvider.MERCADO_PAGO,
      status: PaymentAccountStatus.CONNECTED,
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

    expect(resumeMock).toHaveBeenCalledWith(
      'restaurant-1',
      PaymentGatewayProvider.MERCADO_PAGO,
    );
    expect(result.status).toBe(PaymentAccountStatus.CONNECTED);
  });
});
