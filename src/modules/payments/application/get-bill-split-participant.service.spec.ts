import { NotFoundException } from '@nestjs/common';
import {
  BillSplitParticipantStatus,
  BillStatus,
  PaymentGatewayProvider,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { GetBillSplitParticipantService } from './get-bill-split-participant.service';
import type { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';
import type { PaymentGatewayRegistry } from '../infrastructure/payment-gateway-registry.service';

describe('GetBillSplitParticipantService', () => {
  const findFirstMock = jest.fn();
  const prisma = {
    billSplitParticipant: {
      findFirst: findFirstMock,
    },
  } as unknown as PrismaService;

  const findConnectedByRestaurantMock = jest.fn();
  const restaurantPaymentAccountRepository = {
    findConnectedByRestaurant: findConnectedByRestaurantMock,
  } as unknown as RestaurantPaymentAccountRepository;

  const gateways = {
    [PaymentGatewayProvider.MERCADO_PAGO]: { checkoutMode: 'embedded' },
    [PaymentGatewayProvider.TRANSBANK]: { checkoutMode: 'redirect' },
  };
  const registry = {
    get: (provider: PaymentGatewayProvider) => gateways[provider],
  } as unknown as PaymentGatewayRegistry;

  let service: GetBillSplitParticipantService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GetBillSplitParticipantService(
      prisma,
      restaurantPaymentAccountRepository,
      registry,
    );
  });

  const participant = {
    id: 'participant-1',
    displayName: 'Ana',
    allocatedAmount: new Prisma.Decimal(11800),
    paidAmount: new Prisma.Decimal(0),
    status: BillSplitParticipantStatus.PENDING,
    billSplit: {
      bill: {
        status: BillStatus.PARTIALLY_PAID,
        branch: {
          restaurantId: 'restaurant-1',
          restaurant: {
            currency: 'CLP',
          },
        },
      },
    },
  };

  const expectedDetail = {
    participantId: 'participant-1',
    displayName: 'Ana',
    allocatedAmount: '11800',
    paidAmount: '0',
    status: BillSplitParticipantStatus.PENDING,
    currency: 'CLP',
    billStatus: BillStatus.PARTIALLY_PAID,
  };

  it('returns no options when there is no connected account', async () => {
    findFirstMock.mockResolvedValue(participant);
    findConnectedByRestaurantMock.mockResolvedValue([]);

    const result = await service.execute('participant-token-1');

    expect(result).toEqual({ ...expectedDetail, options: [] });
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { participantToken: 'participant-token-1' },
      }),
    );
    expect(findConnectedByRestaurantMock).toHaveBeenCalledWith('restaurant-1');
  });

  it('returns an embedded option for a connected Mercado Pago account', async () => {
    findFirstMock.mockResolvedValue(participant);
    findConnectedByRestaurantMock.mockResolvedValue([
      {
        provider: PaymentGatewayProvider.MERCADO_PAGO,
        publicKey: 'public-key-1',
        environment: 'sandbox',
      },
    ]);

    const result = await service.execute('participant-token-1');

    expect(result).toEqual({
      ...expectedDetail,
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
  });

  it('returns a redirect option for a restaurant connected only to Transbank', async () => {
    findFirstMock.mockResolvedValue(participant);
    findConnectedByRestaurantMock.mockResolvedValue([
      {
        provider: PaymentGatewayProvider.TRANSBANK,
        publicKey: null,
        environment: 'integration',
      },
    ]);

    const result = await service.execute('participant-token-1');

    expect(result.options).toEqual([
      {
        provider: PaymentGatewayProvider.TRANSBANK,
        checkoutMode: 'redirect',
        publicKey: undefined,
        environment: 'integration',
        isPreferred: true,
      },
    ]);
  });

  it('throws NotFoundException when the token does not match any participant', async () => {
    findFirstMock.mockResolvedValue(null);

    await expect(service.execute('bad-token')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
