import { ConflictException } from '@nestjs/common';
import { PaymentAttemptStatus } from '@prisma/client';
import type { PaymentAttempt } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConfirmRedirectPaymentService } from './confirm-redirect-payment.service';
import { ReconcileTransbankPaymentsService } from './reconcile-transbank-payments.service';

describe('ReconcileTransbankPaymentsService', () => {
  const findManyMock = jest.fn();
  const prisma = {
    paymentAttempt: { findMany: findManyMock },
  } as unknown as PrismaService;

  const reconcilePendingAttemptMock = jest.fn();
  const confirmRedirectPaymentService = {
    reconcilePendingAttempt: reconcilePendingAttemptMock,
  } as unknown as ConfirmRedirectPaymentService;

  let service: ReconcileTransbankPaymentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-07-27T12:30:00.000Z'));
    service = new ReconcileTransbankPaymentsService(
      prisma,
      confirmRedirectPaymentService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const buildAttempt = (id: string): PaymentAttempt =>
    ({
      id,
      provider: 'TRANSBANK',
      providerReference: `token-${id}`,
      status: PaymentAttemptStatus.PENDING,
    }) as unknown as PaymentAttempt;

  it('queries only PENDING Transbank attempts with a providerReference older than the configured threshold', async () => {
    findManyMock.mockResolvedValue([]);

    await service.execute(10);

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        provider: 'TRANSBANK',
        status: PaymentAttemptStatus.PENDING,
        providerReference: { not: null },
        createdAt: { lte: new Date('2026-07-27T12:20:00.000Z') },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  });

  it('tallies an attempt approved late by the gateway', async () => {
    const attempt = buildAttempt('attempt-1');
    findManyMock.mockResolvedValue([attempt]);
    reconcilePendingAttemptMock.mockResolvedValue({
      kind: 'APPROVED',
      payment: { paymentId: 'payment-1' },
    });

    const summary = await service.execute(10);

    expect(reconcilePendingAttemptMock).toHaveBeenCalledWith(attempt);
    expect(summary).toEqual({
      scanned: 1,
      approved: 1,
      rejected: 0,
      stillPending: 0,
      resolvedConcurrently: 0,
    });
  });

  it('tallies an attempt rejected by the gateway', async () => {
    const attempt = buildAttempt('attempt-2');
    findManyMock.mockResolvedValue([attempt]);
    reconcilePendingAttemptMock.mockResolvedValue({
      kind: 'REJECTED',
      failureReason: 'El pago fue rechazado por el proveedor.',
    });

    const summary = await service.execute(10);

    expect(summary).toEqual({
      scanned: 1,
      approved: 0,
      rejected: 1,
      stillPending: 0,
      resolvedConcurrently: 0,
    });
  });

  it('tallies an attempt Transbank has no record of as rejected', async () => {
    const attempt = buildAttempt('attempt-3');
    findManyMock.mockResolvedValue([attempt]);
    reconcilePendingAttemptMock.mockResolvedValue({
      kind: 'REJECTED',
      failureReason:
        'La pasarela de pago no tiene un registro de esta transaccion. El intento se marca como fallido.',
    });

    const summary = await service.execute(10);

    expect(summary.rejected).toBe(1);
  });

  it('tallies an attempt still pending at the gateway without failing it', async () => {
    const attempt = buildAttempt('attempt-4');
    findManyMock.mockResolvedValue([attempt]);
    reconcilePendingAttemptMock.mockResolvedValue({ kind: 'STILL_PENDING' });

    const summary = await service.execute(10);

    expect(summary.stillPending).toBe(1);
  });

  it('counts a ConflictException as resolved concurrently instead of a job failure', async () => {
    const attempt = buildAttempt('attempt-5');
    findManyMock.mockResolvedValue([attempt]);
    reconcilePendingAttemptMock.mockRejectedValue(
      new ConflictException('El intento de pago ya fue resuelto.'),
    );

    const summary = await service.execute(10);

    expect(summary.resolvedConcurrently).toBe(1);
  });

  it('keeps processing remaining attempts when one of them throws an unexpected error', async () => {
    const failingAttempt = buildAttempt('attempt-6');
    const okAttempt = buildAttempt('attempt-7');
    findManyMock.mockResolvedValue([failingAttempt, okAttempt]);
    reconcilePendingAttemptMock
      .mockRejectedValueOnce(new Error('timeout hablando con Transbank'))
      .mockResolvedValueOnce({ kind: 'APPROVED', payment: {} });

    const summary = await service.execute(10);

    expect(summary.scanned).toBe(2);
    expect(summary.approved).toBe(1);
    expect(reconcilePendingAttemptMock).toHaveBeenCalledTimes(2);
  });

  it('does nothing and returns an empty summary when there are no eligible attempts', async () => {
    findManyMock.mockResolvedValue([]);

    const summary = await service.execute(10);

    expect(summary).toEqual({
      scanned: 0,
      approved: 0,
      rejected: 0,
      stillPending: 0,
      resolvedConcurrently: 0,
    });
    expect(reconcilePendingAttemptMock).not.toHaveBeenCalled();
  });
});
