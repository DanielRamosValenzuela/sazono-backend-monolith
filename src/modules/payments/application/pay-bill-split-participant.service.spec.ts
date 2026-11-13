import { ConflictException } from '@nestjs/common';
import {
  BillSplitParticipantStatus,
  BillStatus,
  PaymentAttemptStatus,
  Prisma,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ChargePaymentService } from './charge-payment.service';
import { FailPaymentService } from './fail-payment.service';
import { FinalizePaymentService } from './finalize-payment.service';
import { PayBillSplitParticipantService } from './pay-bill-split-participant.service';
import type { OfflinePaymentRecorderPort } from './ports/offline-payment-recorder.port';

describe('PayBillSplitParticipantService', () => {
  const participantFindFirstMock = jest.fn();
  const attemptCreateMock = jest.fn();
  const attemptUpdateMock = jest.fn();
  const attemptFindFirstMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    billSplitParticipant: { findFirst: participantFindFirstMock },
    paymentAttempt: {
      create: attemptCreateMock,
      updateMany: attemptUpdateMock,
      findFirst: attemptFindFirstMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const offlinePaymentRecorder: OfflinePaymentRecorderPort = {
    providerName: 'MANUAL',
    record: jest.fn(),
  };
  const chargeExecuteMock = jest.fn();
  const chargePaymentService = {
    execute: chargeExecuteMock,
  } as unknown as ChargePaymentService;

  let service: PayBillSplitParticipantService;

  beforeEach(() => {
    jest.clearAllMocks();
    attemptFindFirstMock.mockResolvedValue(null);
    attemptCreateMock.mockResolvedValue({ id: 'attempt-1' });
    attemptUpdateMock.mockResolvedValue({});
    participantFindFirstMock.mockResolvedValue({
      id: 'participant-1',
      billSplitId: 'split-1',
      status: BillSplitParticipantStatus.PENDING,
      allocatedAmount: new Prisma.Decimal(5000),
      paidAmount: new Prisma.Decimal(0),
      billSplit: {
        bill: {
          id: 'bill-1',
          status: BillStatus.OPEN,
          branch: {
            restaurantId: 'restaurant-1',
            restaurant: { currency: 'CLP' },
          },
        },
      },
    });
    service = new PayBillSplitParticipantService(
      prisma,
      offlinePaymentRecorder,
      chargePaymentService,
      new FinalizePaymentService(),
      new FailPaymentService(),
    );
  });

  const dto = {
    tipAmount: '300',
    cardToken: 't',
    paymentMethodId: 'visa',
    installments: 1,
  } as never;

  it('keeps the attempt PENDING bound to the participant and credits nothing when the charge is pending', async () => {
    chargeExecuteMock.mockResolvedValue({
      kind: 'PENDING',
      providerName: 'MERCADO_PAGO',
      providerReference: 'ORD01',
    });

    await expect(service.execute('token', dto)).rejects.toThrow(/en revision/);

    expect(attemptCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tipAmount: new Prisma.Decimal(300),
        billSplitParticipantId: 'participant-1',
      }),
    });
    expect(attemptUpdateMock).toHaveBeenCalledWith({
      where: { id: 'attempt-1', status: PaymentAttemptStatus.PENDING },
      data: { provider: 'MERCADO_PAGO', providerReference: 'ORD01' },
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('refuses a new charge while a Mercado Pago attempt for the participant is in review', async () => {
    attemptFindFirstMock.mockResolvedValue({ id: 'attempt-0' });

    await expect(service.execute('token', dto)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(attemptCreateMock).not.toHaveBeenCalled();
    expect(chargeExecuteMock).not.toHaveBeenCalled();
  });
});
