import { NotFoundException } from '@nestjs/common';
import {
  BillSplitParticipantStatus,
  BillStatus,
  PaymentAccountStatus,
  PaymentGatewayProvider,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { GetBillSplitParticipantService } from './get-bill-split-participant.service';
import type { RestaurantPaymentAccountRepository } from '../infrastructure/mercado-pago/restaurant-payment-account.repository';

describe('GetBillSplitParticipantService', () => {
  const findFirstMock = jest.fn();
  const prisma = {
    billSplitParticipant: {
      findFirst: findFirstMock,
    },
  } as unknown as PrismaService;

  const findByRestaurantMock = jest.fn();
  const restaurantPaymentAccountRepository = {
    findByRestaurant: findByRestaurantMock,
  } as unknown as RestaurantPaymentAccountRepository;

  let service: GetBillSplitParticipantService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GetBillSplitParticipantService(
      prisma,
      restaurantPaymentAccountRepository,
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

  it('returns the participant detail with gatewayConnected false when there is no connected account', async () => {
    findFirstMock.mockResolvedValue(participant);
    findByRestaurantMock.mockResolvedValue(null);

    const result = await service.execute('participant-token-1');

    expect(result).toEqual({
      participantId: 'participant-1',
      displayName: 'Ana',
      allocatedAmount: '11800',
      paidAmount: '0',
      status: BillSplitParticipantStatus.PENDING,
      currency: 'CLP',
      billStatus: BillStatus.PARTIALLY_PAID,
      gatewayConnected: false,
    });
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { participantToken: 'participant-token-1' },
      }),
    );
    expect(findByRestaurantMock).toHaveBeenCalledWith('restaurant-1');
  });

  it('returns gatewayConnected false when the account is not CONNECTED', async () => {
    findFirstMock.mockResolvedValue(participant);
    findByRestaurantMock.mockResolvedValue({
      status: PaymentAccountStatus.PENDING,
      publicKey: 'public-key-1',
      environment: 'sandbox',
    });

    const result = await service.execute('participant-token-1');

    expect(result.gatewayConnected).toBe(false);
  });

  it('returns the public gateway config when the account is CONNECTED', async () => {
    findFirstMock.mockResolvedValue(participant);
    findByRestaurantMock.mockResolvedValue({
      status: PaymentAccountStatus.CONNECTED,
      publicKey: 'public-key-1',
      environment: 'sandbox',
    });

    const result = await service.execute('participant-token-1');

    expect(result).toEqual({
      participantId: 'participant-1',
      displayName: 'Ana',
      allocatedAmount: '11800',
      paidAmount: '0',
      status: BillSplitParticipantStatus.PENDING,
      currency: 'CLP',
      billStatus: BillStatus.PARTIALLY_PAID,
      gatewayConnected: true,
      provider: PaymentGatewayProvider.MERCADO_PAGO,
      publicKey: 'public-key-1',
      environment: 'sandbox',
    });
  });

  it('throws NotFoundException when the token does not match any participant', async () => {
    findFirstMock.mockResolvedValue(null);

    await expect(service.execute('bad-token')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
