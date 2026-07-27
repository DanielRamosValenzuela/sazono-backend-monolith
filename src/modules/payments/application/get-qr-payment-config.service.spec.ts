import { NotFoundException } from '@nestjs/common';
import {
  PaymentAccountStatus,
  PaymentGatewayProvider,
  TableStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { GetQrPaymentConfigService } from './get-qr-payment-config.service';
import type { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';

describe('GetQrPaymentConfigService', () => {
  const tableFindUniqueMock = jest.fn();
  const prisma = {
    table: {
      findUnique: tableFindUniqueMock,
    },
  } as unknown as PrismaService;

  const findByRestaurantMock = jest.fn();
  const restaurantPaymentAccountRepository = {
    findByRestaurant: findByRestaurantMock,
  } as unknown as RestaurantPaymentAccountRepository;

  let service: GetQrPaymentConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GetQrPaymentConfigService(
      prisma,
      restaurantPaymentAccountRepository,
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

  it('returns gatewayConnected false when there is no connected account', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    findByRestaurantMock.mockResolvedValue(null);

    await expect(service.execute('qr-token-1')).resolves.toEqual({
      gatewayConnected: false,
    });
  });

  it('returns gatewayConnected false when the account is not CONNECTED', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    findByRestaurantMock.mockResolvedValue({
      status: PaymentAccountStatus.PENDING,
      publicKey: 'public-key-1',
      environment: 'sandbox',
    });

    await expect(service.execute('qr-token-1')).resolves.toEqual({
      gatewayConnected: false,
    });
  });

  it('returns gatewayConnected false when a connected account has no publicKey', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    findByRestaurantMock.mockResolvedValue({
      status: PaymentAccountStatus.CONNECTED,
      publicKey: null,
      environment: 'sandbox',
    });

    await expect(service.execute('qr-token-1')).resolves.toEqual({
      gatewayConnected: false,
    });
  });

  it('returns the public gateway config when the account is CONNECTED', async () => {
    tableFindUniqueMock.mockResolvedValue(table);
    findByRestaurantMock.mockResolvedValue({
      status: PaymentAccountStatus.CONNECTED,
      publicKey: 'public-key-1',
      environment: 'sandbox',
    });

    await expect(service.execute('qr-token-1')).resolves.toEqual({
      gatewayConnected: true,
      provider: PaymentGatewayProvider.MERCADO_PAGO,
      publicKey: 'public-key-1',
      environment: 'sandbox',
    });
  });
});
