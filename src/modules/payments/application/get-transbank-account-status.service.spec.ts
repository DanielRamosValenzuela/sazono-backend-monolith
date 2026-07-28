import { PaymentAccountStatus, PaymentGatewayProvider } from '@prisma/client';
import { GetTransbankAccountStatusService } from './get-transbank-account-status.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';

describe('GetTransbankAccountStatusService', () => {
  const getStaffContextMock = jest.fn();
  const branchAccessService = {
    getStaffContext: getStaffContextMock,
  } as unknown as BranchAccessService;

  const findByRestaurantAndProviderMock = jest.fn();
  const restaurantPaymentAccountRepository = {
    findByRestaurantAndProvider: findByRestaurantAndProviderMock,
  } as unknown as RestaurantPaymentAccountRepository;

  let service: GetTransbankAccountStatusService;

  const authUser = {} as JwtPayload;

  beforeEach(() => {
    jest.clearAllMocks();
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      memberBranchIds: new Set(['branch-1']),
      adminBranchIds: new Set(['branch-1']),
    });
    service = new GetTransbankAccountStatusService(
      branchAccessService,
      restaurantPaymentAccountRepository,
    );
  });

  it('returns null when the restaurant never connected a Transbank account', async () => {
    findByRestaurantAndProviderMock.mockResolvedValue(null);

    await expect(service.execute(authUser)).resolves.toBeNull();
    expect(findByRestaurantAndProviderMock).toHaveBeenCalledWith(
      'restaurant-1',
      PaymentGatewayProvider.TRANSBANK,
    );
  });

  it('maps the connected account to a status response without exposing platform credentials', async () => {
    findByRestaurantAndProviderMock.mockResolvedValue({
      provider: PaymentGatewayProvider.TRANSBANK,
      status: PaymentAccountStatus.CONNECTED,
      environment: 'integration',
      displayPriority: 0,
      externalAccountId: null,
      publicKey: null,
      childCommerceCode: '597055555536',
      liveMode: false,
      scope: null,
      connectedAt: new Date('2026-07-27T12:00:00.000Z'),
      accessTokenExpiresAt: null,
      lastErrorMessage: null,
    });

    const result = await service.execute(authUser);

    expect(result?.childCommerceCode).toBe('597055555536');
    expect(result?.status).toBe(PaymentAccountStatus.CONNECTED);
  });
});
