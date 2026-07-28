import { PaymentGatewayProvider } from '@prisma/client';
import { PaymentGatewayResolverService } from './payment-gateway-resolver.service';
import type { PaymentGatewayRegistry } from './payment-gateway-registry.service';
import type { RestaurantPaymentAccountRepository } from './mercado-pago/restaurant-payment-account.repository';
import type { PaymentGatewayPort } from '../application/ports/payment-gateway.port';

describe('PaymentGatewayResolverService', () => {
  const findConnectedByRestaurantMock = jest.fn();
  const getValidAccessTokenForAccountMock = jest.fn();
  const restaurantPaymentAccountRepository = {
    findConnectedByRestaurant: findConnectedByRestaurantMock,
    getValidAccessTokenForAccount: getValidAccessTokenForAccountMock,
  } as unknown as RestaurantPaymentAccountRepository;

  const registryGetMock = jest.fn();
  const paymentGatewayRegistry = {
    get: registryGetMock,
  } as unknown as PaymentGatewayRegistry;

  const mercadoPagoGateway: PaymentGatewayPort = {
    providerName: 'MERCADO_PAGO',
    checkoutMode: 'embedded',
    charge: jest.fn(),
    getPayment: jest.fn(),
  };

  let service: PaymentGatewayResolverService;

  beforeEach(() => {
    jest.clearAllMocks();
    registryGetMock.mockReturnValue(mercadoPagoGateway);
    service = new PaymentGatewayResolverService(
      restaurantPaymentAccountRepository,
      paymentGatewayRegistry,
    );
  });

  it('returns an empty array when there is no connected payment account for the restaurant', async () => {
    findConnectedByRestaurantMock.mockResolvedValue([]);

    await expect(service.resolveAvailable('restaurant-1')).resolves.toEqual([]);
    expect(getValidAccessTokenForAccountMock).not.toHaveBeenCalled();
  });

  it('skips a connected account when no adapter is registered for its provider', async () => {
    findConnectedByRestaurantMock.mockResolvedValue([
      {
        id: 'account-1',
        provider: PaymentGatewayProvider.MERCADO_PAGO,
        publicKey: 'public-key-1',
        environment: 'sandbox',
        displayPriority: 0,
      },
    ]);
    registryGetMock.mockReturnValue(undefined);

    await expect(service.resolveAvailable('restaurant-1')).resolves.toEqual([]);
    expect(getValidAccessTokenForAccountMock).not.toHaveBeenCalled();
  });

  it('skips a connected account when it has no valid access token', async () => {
    findConnectedByRestaurantMock.mockResolvedValue([
      {
        id: 'account-1',
        provider: PaymentGatewayProvider.MERCADO_PAGO,
        publicKey: 'public-key-1',
        environment: 'sandbox',
        displayPriority: 0,
      },
    ]);
    getValidAccessTokenForAccountMock.mockResolvedValue(null);

    await expect(service.resolveAvailable('restaurant-1')).resolves.toEqual([]);
  });

  it('resolves a MercadoPago gateway for a CONNECTED account with a valid access token', async () => {
    findConnectedByRestaurantMock.mockResolvedValue([
      {
        id: 'account-1',
        provider: PaymentGatewayProvider.MERCADO_PAGO,
        publicKey: 'public-key-1',
        environment: 'sandbox',
        displayPriority: 5,
      },
    ]);
    getValidAccessTokenForAccountMock.mockResolvedValue(
      'APP_USR-restaurant-token',
    );

    const resolved = await service.resolveAvailable('restaurant-1');

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toEqual({
      provider: PaymentGatewayProvider.MERCADO_PAGO,
      gateway: mercadoPagoGateway,
      accountId: 'account-1',
      publicKey: 'public-key-1',
      environment: 'sandbox',
      checkoutMode: 'embedded',
      displayPriority: 5,
      credentials: { accessToken: 'APP_USR-restaurant-token' },
    });
  });

  it('preserves the order already returned by the repository (displayPriority desc, connectedAt asc)', async () => {
    findConnectedByRestaurantMock.mockResolvedValue([
      {
        id: 'account-high-priority',
        provider: PaymentGatewayProvider.MERCADO_PAGO,
        publicKey: 'public-key-high',
        environment: 'sandbox',
        displayPriority: 10,
      },
      {
        id: 'account-low-priority',
        provider: PaymentGatewayProvider.MERCADO_PAGO,
        publicKey: 'public-key-low',
        environment: 'sandbox',
        displayPriority: 0,
      },
    ]);
    getValidAccessTokenForAccountMock.mockResolvedValue('token');

    const resolved = await service.resolveAvailable('restaurant-1');

    expect(resolved.map((entry) => entry.accountId)).toEqual([
      'account-high-priority',
      'account-low-priority',
    ]);
  });

  it('resolves a Transbank gateway using its childCommerceCode instead of an access token', async () => {
    const transbankGateway: PaymentGatewayPort = {
      providerName: 'TRANSBANK',
      checkoutMode: 'redirect',
      charge: jest.fn(),
      getPayment: jest.fn(),
    };
    registryGetMock.mockReturnValue(transbankGateway);
    findConnectedByRestaurantMock.mockResolvedValue([
      {
        id: 'account-transbank-1',
        provider: PaymentGatewayProvider.TRANSBANK,
        publicKey: null,
        environment: 'integration',
        displayPriority: 0,
        childCommerceCode: '597055555536',
      },
    ]);

    const resolved = await service.resolveAvailable('restaurant-1');

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toEqual({
      provider: PaymentGatewayProvider.TRANSBANK,
      gateway: transbankGateway,
      accountId: 'account-transbank-1',
      publicKey: null,
      environment: 'integration',
      checkoutMode: 'redirect',
      displayPriority: 0,
      credentials: { childCommerceCode: '597055555536' },
    });
    expect(getValidAccessTokenForAccountMock).not.toHaveBeenCalled();
  });

  it('skips a connected Transbank account that has no childCommerceCode', async () => {
    registryGetMock.mockReturnValue({
      providerName: 'TRANSBANK',
      checkoutMode: 'redirect',
      charge: jest.fn(),
      getPayment: jest.fn(),
    });
    findConnectedByRestaurantMock.mockResolvedValue([
      {
        id: 'account-transbank-1',
        provider: PaymentGatewayProvider.TRANSBANK,
        publicKey: null,
        environment: 'integration',
        displayPriority: 0,
        childCommerceCode: null,
      },
    ]);

    await expect(service.resolveAvailable('restaurant-1')).resolves.toEqual([]);
  });
});
