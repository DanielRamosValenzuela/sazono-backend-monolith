import { NotFoundException } from '@nestjs/common';
import { PaymentGatewayProvider, TableStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { GetQrPaymentConfigService } from './get-qr-payment-config.service';
import type { PaymentGatewayRegistry } from '../infrastructure/payment-gateway-registry.service';
import type { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';
import type { PaymentGatewayPort } from './ports/payment-gateway.port';

describe('GetQrPaymentConfigService', () => {
  const tableFindUniqueMock = jest.fn();
  const prisma = {
    table: {
      findUnique: tableFindUniqueMock,
    },
  } as unknown as PrismaService;

  const findConnectedByRestaurantMock = jest.fn();
  const restaurantPaymentAccountRepository = {
    findConnectedByRestaurant: findConnectedByRestaurantMock,
  } as unknown as RestaurantPaymentAccountRepository;

  const registryGetMock = jest.fn();
  const paymentGatewayRegistry = {
    get: registryGetMock,
  } as unknown as PaymentGatewayRegistry;

  const embeddedGateway: PaymentGatewayPort = {
    providerName: 'MERCADO_PAGO',
    checkoutMode: 'embedded',
    charge: jest.fn(),
    getPayment: jest.fn(),
  };

  let service: GetQrPaymentConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    registryGetMock.mockReturnValue(embeddedGateway);
    service = new GetQrPaymentConfigService(
      prisma,
      restaurantPaymentAccountRepository,
      paymentGatewayRegistry,
    );
  });

  const table = {
    id: 'table-1',
    status: TableStatus.OCCUPIED,
    branch: { restaurantId: 'restaurant-1' },
  };

  it('throws when the QR token does not match any table', async () => {
    tableFindUniqueMock.mockResolvedValue(null);

    await expect(service.execute('qr-token-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws when the table is disabled', async () => {
    tableFindUniqueMock.mockResolvedValue({
      ...table,
      status: TableStatus.DISABLED,
    });

    await expect(service.execute('qr-token-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns an empty options array when there is no connected account', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    findConnectedByRestaurantMock.mockResolvedValue([]);

    await expect(service.execute('qr-token-1')).resolves.toEqual({
      options: [],
    });
  });

  it('skips a connected account when no adapter is registered for its provider', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    findConnectedByRestaurantMock.mockResolvedValue([
      {
        provider: PaymentGatewayProvider.MERCADO_PAGO,
        publicKey: 'public-key-1',
        environment: 'sandbox',
      },
    ]);
    registryGetMock.mockReturnValue(undefined);

    await expect(service.execute('qr-token-1')).resolves.toEqual({
      options: [],
    });
  });

  it('skips an embedded-checkout account that has no publicKey', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    findConnectedByRestaurantMock.mockResolvedValue([
      {
        provider: PaymentGatewayProvider.MERCADO_PAGO,
        publicKey: null,
        environment: 'sandbox',
      },
    ]);

    await expect(service.execute('qr-token-1')).resolves.toEqual({
      options: [],
    });
  });

  it('returns the connected gateway as the preferred option, ordered as returned by the repository', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    findConnectedByRestaurantMock.mockResolvedValue([
      {
        provider: PaymentGatewayProvider.MERCADO_PAGO,
        publicKey: 'public-key-1',
        environment: 'sandbox',
      },
    ]);

    await expect(service.execute('qr-token-1')).resolves.toEqual({
      options: [
        {
          provider: PaymentGatewayProvider.MERCADO_PAGO,
          checkoutMode: 'embedded',
          publicKey: 'public-key-1',
          environment: 'sandbox',
          isPreferred: true,
        },
      ],
    });
    expect(findConnectedByRestaurantMock).toHaveBeenCalledWith('restaurant-1');
  });
});
