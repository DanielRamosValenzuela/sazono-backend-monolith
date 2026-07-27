import { PaymentAccountStatus } from '@prisma/client';
import { PaymentGatewayResolverService } from './payment-gateway-resolver.service';
import type { MercadoPagoConfigService } from './mercado-pago/mercado-pago-config.service';
import type { RestaurantPaymentAccountRepository } from './mercado-pago/restaurant-payment-account.repository';

describe('PaymentGatewayResolverService', () => {
  const findByRestaurantMock = jest.fn();
  const getValidAccessTokenMock = jest.fn();
  const restaurantPaymentAccountRepository = {
    findByRestaurant: findByRestaurantMock,
    getValidAccessToken: getValidAccessTokenMock,
  } as unknown as RestaurantPaymentAccountRepository;

  const mercadoPagoConfig = {
    timeoutMs: 15000,
  } as unknown as MercadoPagoConfigService;

  let service: PaymentGatewayResolverService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentGatewayResolverService(
      restaurantPaymentAccountRepository,
      mercadoPagoConfig,
    );
  });

  it('returns null when there is no payment account for the restaurant', async () => {
    findByRestaurantMock.mockResolvedValue(null);

    await expect(service.resolve('restaurant-1')).resolves.toBeNull();
    expect(getValidAccessTokenMock).not.toHaveBeenCalled();
  });

  it('returns null when the account is not CONNECTED', async () => {
    findByRestaurantMock.mockResolvedValue({
      id: 'account-1',
      status: PaymentAccountStatus.PENDING,
      publicKey: 'public-key-1',
      environment: 'sandbox',
    });

    await expect(service.resolve('restaurant-1')).resolves.toBeNull();
    expect(getValidAccessTokenMock).not.toHaveBeenCalled();
  });

  it('returns null when the account is CONNECTED but no valid access token can be produced', async () => {
    findByRestaurantMock.mockResolvedValue({
      id: 'account-1',
      status: PaymentAccountStatus.CONNECTED,
      publicKey: 'public-key-1',
      environment: 'sandbox',
    });
    getValidAccessTokenMock.mockResolvedValue(null);

    await expect(service.resolve('restaurant-1')).resolves.toBeNull();
  });

  it('resolves a MercadoPago gateway for a CONNECTED account with a valid access token', async () => {
    findByRestaurantMock.mockResolvedValue({
      id: 'account-1',
      status: PaymentAccountStatus.CONNECTED,
      publicKey: 'public-key-1',
      environment: 'sandbox',
    });
    getValidAccessTokenMock.mockResolvedValue('APP_USR-restaurant-token');

    const resolved = await service.resolve('restaurant-1');

    expect(resolved).not.toBeNull();
    expect(resolved?.accountId).toBe('account-1');
    expect(resolved?.publicKey).toBe('public-key-1');
    expect(resolved?.environment).toBe('sandbox');
    expect(resolved?.gateway.providerName).toBe('MERCADO_PAGO');
  });
});
