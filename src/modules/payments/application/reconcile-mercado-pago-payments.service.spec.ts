import { ConflictException } from '@nestjs/common';
import { PaymentAttemptStatus } from '@prisma/client';
import type { PaymentAttempt } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { MercadoPagoConfigService } from '../infrastructure/mercado-pago/mercado-pago-config.service';
import type { ConfirmRedirectPaymentService } from './confirm-redirect-payment.service';
import { ReconcileMercadoPagoPaymentsService } from './reconcile-mercado-pago-payments.service';

describe('ReconcileMercadoPagoPaymentsService', () => {
  const findManyMock = jest.fn();
  const prisma = {
    paymentAttempt: { findMany: findManyMock },
  } as unknown as PrismaService;

  const reconcilePendingAttemptMock = jest.fn();
  const rejectUnresolvableAttemptMock = jest.fn();
  const confirmRedirectPaymentService = {
    reconcilePendingAttempt: reconcilePendingAttemptMock,
    rejectUnresolvableAttempt: rejectUnresolvableAttemptMock,
  } as unknown as ConfirmRedirectPaymentService;

  const mercadoPagoConfig = { apiMode: 'orders' } as unknown as {
    apiMode: 'payments' | 'orders';
  };

  let service: ReconcileMercadoPagoPaymentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    mercadoPagoConfig.apiMode = 'orders';
    jest.useFakeTimers().setSystemTime(new Date('2026-07-27T12:30:00.000Z'));
    service = new ReconcileMercadoPagoPaymentsService(
      prisma,
      confirmRedirectPaymentService,
      mercadoPagoConfig as unknown as MercadoPagoConfigService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const HOUR_MS = 60 * 60 * 1000;

  const buildAttempt = (
    id: string,
    overrides: Partial<PaymentAttempt> = {},
  ): PaymentAttempt =>
    ({
      id,
      provider: 'MERCADO_PAGO',
      providerReference: `ORD-${id}`,
      createdAt: new Date(Date.now() - HOUR_MS),
      ...overrides,
      status: PaymentAttemptStatus.PENDING,
    }) as unknown as PaymentAttempt;

  it('does nothing in payments mode', async () => {
    mercadoPagoConfig.apiMode = 'payments';

    const summary = await service.execute(5);

    expect(summary.scanned).toBe(0);
    expect(findManyMock).not.toHaveBeenCalled();
    expect(reconcilePendingAttemptMock).not.toHaveBeenCalled();
  });

  it('queries only PENDING Mercado Pago attempts older than the threshold', async () => {
    findManyMock.mockResolvedValue([]);

    await service.execute(5);

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        provider: 'MERCADO_PAGO',
        status: PaymentAttemptStatus.PENDING,
        createdAt: { lte: new Date('2026-07-27T12:25:00.000Z') },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  });

  it('reconciles each attempt without failing it when Mercado Pago cannot be queried and tallies every outcome', async () => {
    const attempts = ['a', 'b', 'c', 'd', 'e'].map((id) => buildAttempt(id));
    findManyMock.mockResolvedValue(attempts);
    reconcilePendingAttemptMock
      .mockResolvedValueOnce({ kind: 'APPROVED', payment: {} })
      .mockResolvedValueOnce({ kind: 'REJECTED', failureReason: 'x' })
      .mockResolvedValueOnce({ kind: 'STILL_PENDING' })
      .mockRejectedValueOnce(new ConflictException('resuelto'))
      .mockRejectedValueOnce(new Error('boom'));

    const summary = await service.execute(5);

    expect(reconcilePendingAttemptMock).toHaveBeenNthCalledWith(
      1,
      attempts[0],
      { rejectWhenMissingAtProvider: false },
    );
    expect(summary).toEqual({
      scanned: 5,
      approved: 1,
      rejected: 1,
      stillPending: 1,
      resolvedConcurrently: 1,
    });
  });

  it('rejects an attempt still in review after 48 hours', async () => {
    const stale = buildAttempt('old', {
      createdAt: new Date(Date.now() - 49 * HOUR_MS),
    });
    findManyMock.mockResolvedValue([stale]);
    reconcilePendingAttemptMock.mockResolvedValue({ kind: 'STILL_PENDING' });

    const summary = await service.execute(5);

    expect(reconcilePendingAttemptMock).toHaveBeenCalledWith(stale, {
      rejectWhenMissingAtProvider: true,
    });
    expect(rejectUnresolvableAttemptMock).toHaveBeenCalledWith(
      stale,
      expect.stringContaining('revision'),
    );
    expect(summary.rejected).toBe(1);
    expect(summary.stillPending).toBe(0);
  });

  it('keeps a recent attempt pending and does not reject it when it is missing at the provider', async () => {
    const recent = buildAttempt('new');
    findManyMock.mockResolvedValue([recent]);
    reconcilePendingAttemptMock.mockResolvedValue({ kind: 'STILL_PENDING' });

    const summary = await service.execute(5);

    expect(reconcilePendingAttemptMock).toHaveBeenCalledWith(recent, {
      rejectWhenMissingAtProvider: false,
    });
    expect(rejectUnresolvableAttemptMock).not.toHaveBeenCalled();
    expect(summary.stillPending).toBe(1);
  });

  it('lets an attempt without reference be rejected when nothing is found after the grace period', async () => {
    const orphan = buildAttempt('orphan', {
      providerReference: null,
      createdAt: new Date(Date.now() - 3 * HOUR_MS),
    });
    findManyMock.mockResolvedValue([orphan]);
    reconcilePendingAttemptMock.mockResolvedValue({
      kind: 'REJECTED',
      failureReason: 'x',
    });

    await service.execute(5);

    expect(reconcilePendingAttemptMock).toHaveBeenCalledWith(orphan, {
      rejectWhenMissingAtProvider: true,
    });
  });
});
