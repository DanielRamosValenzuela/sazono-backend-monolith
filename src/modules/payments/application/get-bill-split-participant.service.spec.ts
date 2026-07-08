import { NotFoundException } from '@nestjs/common';
import { BillSplitParticipantStatus, BillStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { GetBillSplitParticipantService } from './get-bill-split-participant.service';

describe('GetBillSplitParticipantService', () => {
  const findFirstMock = jest.fn();
  const prisma = {
    billSplitParticipant: {
      findFirst: findFirstMock,
    },
  } as unknown as PrismaService;

  let service: GetBillSplitParticipantService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GetBillSplitParticipantService(prisma);
  });

  it('returns the participant detail with currency and bill status', async () => {
    findFirstMock.mockResolvedValue({
      id: 'participant-1',
      displayName: 'Ana',
      allocatedAmount: new Prisma.Decimal(11800),
      paidAmount: new Prisma.Decimal(0),
      status: BillSplitParticipantStatus.PENDING,
      billSplit: {
        bill: {
          status: BillStatus.PARTIALLY_PAID,
          branch: {
            restaurant: {
              currency: 'CLP',
            },
          },
        },
      },
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
    });
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { participantToken: 'participant-token-1' },
      }),
    );
  });

  it('throws NotFoundException when the token does not match any participant', async () => {
    findFirstMock.mockResolvedValue(null);

    await expect(service.execute('bad-token')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
