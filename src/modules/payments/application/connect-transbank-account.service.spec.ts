import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PaymentAccountStatus, PaymentGatewayProvider } from '@prisma/client';
import { ConnectTransbankAccountService } from './connect-transbank-account.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';
import type { TransbankConfigService } from '../infrastructure/transbank/transbank-config.service';

describe('ConnectTransbankAccountService', () => {
  const getStaffContextMock = jest.fn();
  const branchAccessService = {
    getStaffContext: getStaffContextMock,
  } as unknown as BranchAccessService;

  const upsertManualConnectionMock = jest.fn();
  const restaurantPaymentAccountRepository = {
    upsertManualConnection: upsertManualConnectionMock,
  } as unknown as RestaurantPaymentAccountRepository;

  let transbankConfig: TransbankConfigService;
  let service: ConnectTransbankAccountService;

  const authUser = {} as JwtPayload;

  beforeEach(() => {
    jest.clearAllMocks();
    transbankConfig = {
      isEnabled: true,
      environment: 'integration',
    } as unknown as TransbankConfigService;
    service = new ConnectTransbankAccountService(
      branchAccessService,
      restaurantPaymentAccountRepository,
      transbankConfig,
    );
  });

  it('throws when Transbank is not enabled in this environment', async () => {
    transbankConfig = {
      isEnabled: false,
      environment: 'integration',
    } as unknown as TransbankConfigService;
    service = new ConnectTransbankAccountService(
      branchAccessService,
      restaurantPaymentAccountRepository,
      transbankConfig,
    );

    await expect(
      service.execute(authUser, { childCommerceCode: '597055555536' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(getStaffContextMock).not.toHaveBeenCalled();
  });

  it('rejects a staff member without an ADMIN role', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      memberBranchIds: new Set(['branch-1']),
      adminBranchIds: new Set(),
    });

    await expect(
      service.execute(authUser, { childCommerceCode: '597055555536' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(upsertManualConnectionMock).not.toHaveBeenCalled();
  });

  it('upserts the account with the childCommerceCode and the configured default environment', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      memberBranchIds: new Set(['branch-1']),
      adminBranchIds: new Set(['branch-1']),
    });
    upsertManualConnectionMock.mockResolvedValue({
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

    const result = await service.execute(authUser, {
      childCommerceCode: '597055555536',
    });

    expect(upsertManualConnectionMock).toHaveBeenCalledWith(
      'restaurant-1',
      PaymentGatewayProvider.TRANSBANK,
      { environment: 'integration', childCommerceCode: '597055555536' },
    );
    expect(result.childCommerceCode).toBe('597055555536');
    expect(result.status).toBe(PaymentAccountStatus.CONNECTED);
  });

  it('prefers the environment sent in the request over the configured default', async () => {
    getStaffContextMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      memberBranchIds: new Set(['branch-1']),
      adminBranchIds: new Set(['branch-1']),
    });
    upsertManualConnectionMock.mockResolvedValue({
      provider: PaymentGatewayProvider.TRANSBANK,
      status: PaymentAccountStatus.CONNECTED,
      environment: 'production',
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

    await service.execute(authUser, {
      childCommerceCode: '597055555536',
      environment: 'production',
    });

    expect(upsertManualConnectionMock).toHaveBeenCalledWith(
      'restaurant-1',
      PaymentGatewayProvider.TRANSBANK,
      { environment: 'production', childCommerceCode: '597055555536' },
    );
  });
});
