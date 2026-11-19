import { Prisma, TaxDocumentStatus, TaxDocumentType } from '@prisma/client';
import type { AuditService } from '../../../common/audit/audit.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import {
  buildBoletaSnapshot,
  buildCreditNoteSnapshot,
} from '../domain/tax-snapshot';
import type { RefundCreditNoteSync } from '../infrastructure/refund-credit-note-sync';
import type {
  EmitOutcome,
  StatusOutcome,
  TaxDocumentProviderPort,
} from './ports/tax-document-provider.port';
import { TaxDocumentWorkerService } from './tax-document-worker.service';
import type { TaxDocumentsConfigService } from './tax-documents-config.service';
import type { TaxProviderAccountService } from './tax-provider-account.service';

const emitter = {
  rut: '76795561-8',
  legalName: 'Demo SpA',
  activity: 'Restaurantes',
  economicActivityCode: 561000,
  address: 'Calle 1',
  commune: 'Santiago',
  city: null,
};
const common = {
  issueDate: '2026-11-19',
  billId: 'bill-1',
  billNumber: 1,
  branch: { id: 'br', name: 'Local' },
  emitter,
  tip: 0,
};
const boletaSnapshot = buildBoletaSnapshot({
  ...common,
  idempotencyKey: 'boleta:bill-1',
  paymentMethod: null,
  items: [],
  consumption: 10000,
  net: 8403,
  vat: 1597,
});
const noteSnapshot = buildCreditNoteSnapshot({
  ...common,
  idempotencyKey: 'credit-note:rf1',
  refundId: 'rf1',
  reason: 'Plato frio',
  creditedConsumption: 5000,
  net: 4202,
  vat: 798,
  boletaTaxDocumentId: 'td-boleta',
  boletaTotal: 10000,
});

const NOW = new Date('2026-11-19T15:00:00.000Z');

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'td-1',
    restaurantId: 'rest-1',
    branchId: 'br',
    billId: 'bill-1',
    refundId: null,
    type: TaxDocumentType.BOLETA_AFECTA,
    status: TaxDocumentStatus.PENDING,
    folio: null,
    attempts: 0,
    providerDocId: null,
    createdAt: NOW,
    idempotencyKey: 'boleta:bill-1',
    requestSnapshot: boletaSnapshot,
    referenceDocument: null,
    ...overrides,
  };
}

const accepted: EmitOutcome = {
  kind: 'ACCEPTED',
  token: 'tok1',
  folio: 734085,
  timbre: 'PNG',
  replayed: false,
  raw: { TOKEN: 'tok1', FOLIO: 734085 },
};
const issuedStatus: StatusOutcome = {
  kind: 'STATE',
  state: 'ISSUED',
  providerStatus: 'Aceptado',
  folio: null,
};
const failure = (retryable: boolean, extra = {}): EmitOutcome => ({
  kind: 'FAILED',
  retryable,
  code: retryable ? 'NETWORK' : 'OF-10',
  message: retryable ? 'timeout' : 'MntNeto: Monto erroneo',
  auth: false,
  retryAfterMs: null,
  ...extra,
});

function build(
  document: ReturnType<typeof doc> | null,
  options: {
    emit?: EmitOutcome;
    status?: StatusOutcome;
    credentials?: boolean;
    maxAttempts?: number;
    markIssuedError?: Error;
  } = {},
) {
  let updateManyCalls = 0;
  const prisma: Record<string, unknown> & {
    $queryRaw: jest.Mock;
    taxDocument: Record<string, jest.Mock>;
  } = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'td-1' }]),
    taxDocument: {
      findUnique: jest.fn().mockResolvedValue(document),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn(() => {
        updateManyCalls += 1;

        return options.markIssuedError && updateManyCalls === 1
          ? Promise.reject(options.markIssuedError)
          : Promise.resolve({ count: 1 });
      }),
    },
  };
  prisma.$transaction = jest.fn((cb: (client: unknown) => Promise<unknown>) =>
    cb({ taxDocument: prisma.taxDocument }),
  );
  const provider = {
    providerName: 'openfactura',
    emit: jest.fn().mockResolvedValue(options.emit ?? accepted),
    getStatus: jest.fn().mockResolvedValue(options.status ?? issuedStatus),
  };
  const accounts = {
    resolveCredentials: jest.fn().mockResolvedValue(
      options.credentials === false
        ? null
        : {
            accountId: 'acc-1',
            credentials: { apiKey: 'key-123456', environment: 'SANDBOX' },
          },
    ),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const refundSync = { markIssued: jest.fn().mockResolvedValue(undefined) };
  const config = {
    batchSize: 10,
    leaseSeconds: 120,
    maxAttempts: options.maxAttempts ?? 8,
    retryBaseMs: 30_000,
  };
  const service = new TaxDocumentWorkerService(
    prisma as unknown as PrismaService,
    config as unknown as TaxDocumentsConfigService,
    accounts as unknown as TaxProviderAccountService,
    audit as unknown as AuditService,
    refundSync as unknown as RefundCreditNoteSync,
    provider as unknown as TaxDocumentProviderPort,
  );

  return { service, prisma, provider, accounts, audit, refundSync };
}

type Call = { where: Record<string, unknown>; data: Record<string, unknown> };
const lastUpdate = (ctx: ReturnType<typeof build>) => {
  const calls = ctx.prisma.taxDocument.updateMany.mock.calls as unknown as [
    Call,
  ][];

  return calls[calls.length - 1][0];
};

describe('TaxDocumentWorkerService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('claim', () => {
    it('claims due rows with FOR UPDATE SKIP LOCKED and a lease, boletas before credit notes', async () => {
      const ctx = build(null);

      await expect(ctx.service.claim()).resolves.toEqual(['td-1']);

      const query = (ctx.prisma.$queryRaw.mock.calls[0] as [Prisma.Sql])[0];
      expect(query.sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(query.sql).toContain(`status = 'PENDING'`);
      expect(query.sql).toContain('next_attempt_at <= now()');
      expect(query.sql).toContain(
        `ref.status IN ('ISSUED', 'REJECTED', 'VOIDED')`,
      );
      expect(query.sql).toContain(`ORDER BY (td.type = 'NOTA_CREDITO') ASC`);
      expect(query.values).toEqual(
        expect.arrayContaining(['openfactura', 10, 120]),
      );
    });

    it('runOnce processes every claimed row and survives a failing one', async () => {
      const ctx = build(doc());
      ctx.prisma.$queryRaw.mockResolvedValue([{ id: 'td-1' }, { id: 'td-2' }]);
      ctx.prisma.taxDocument.findUnique
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce(doc({ attempts: 2 }))
        .mockResolvedValueOnce(doc({ id: 'td-2' }));

      await expect(ctx.service.runOnce()).resolves.toEqual({
        claimed: 2,
        failed: 1,
      });
      expect(ctx.provider.emit).toHaveBeenCalledTimes(1);
      expect(ctx.prisma.taxDocument.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'td-1', status: TaxDocumentStatus.PENDING },
          data: expect.objectContaining({
            attempts: 3,
            lastError: '[INTERNAL_ERROR] db down',
          }),
        }),
      );
    });

    it('refreshes the lease before each document and skips ones no longer PENDING', async () => {
      const ctx = build(doc());
      ctx.prisma.$queryRaw.mockResolvedValue([{ id: 'td-1' }, { id: 'td-2' }]);
      ctx.prisma.taxDocument.updateMany.mockResolvedValueOnce({ count: 0 });

      await ctx.service.runOnce();

      expect(ctx.prisma.taxDocument.updateMany).toHaveBeenCalledWith({
        where: { id: 'td-1', status: TaxDocumentStatus.PENDING },
        data: {
          nextAttemptAt: new Date(NOW.getTime() + 120_000),
          lastAttemptAt: NOW,
        },
      });
      expect(ctx.provider.emit).toHaveBeenCalledTimes(1);
    });

    it('re-syncs refunds whose credit note is ISSUED but the refund is not', async () => {
      const ctx = build(null);
      ctx.prisma.$queryRaw.mockResolvedValue([]);
      ctx.prisma.taxDocument.findMany.mockResolvedValue([
        { refundId: 'rf9', folio: 55 },
      ]);

      await ctx.service.runOnce();

      expect(ctx.refundSync.markIssued).toHaveBeenCalledWith('rf9', 55);
    });
  });

  describe('success', () => {
    it('emits with the idempotency key, stores the token and marks the boleta ISSUED', async () => {
      const ctx = build(doc());

      await ctx.service.processOne('td-1');

      expect(ctx.provider.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'boleta:bill-1',
          reference: null,
        }),
      );
      expect(ctx.prisma.taxDocument.update).toHaveBeenCalledWith({
        where: { id: 'td-1' },
        data: expect.objectContaining({
          providerDocId: 'tok1',
          folio: 734085,
          timbre: 'PNG',
          providerStatus: 'Emitido',
        }),
      });
      expect(lastUpdate(ctx).data).toMatchObject({
        status: TaxDocumentStatus.ISSUED,
        folio: 734085,
        attempts: 1,
        lastError: null,
        nextAttemptAt: null,
        providerStatus: 'Aceptado',
      });
      expect(ctx.audit.record).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ action: 'TAX_DOCUMENT_ISSUED' }),
      );
      expect(ctx.refundSync.markIssued).not.toHaveBeenCalled();
    });

    it('syncs the refund credit note status when a credit note is issued', async () => {
      const ctx = build(
        doc({
          id: 'td-nc',
          type: TaxDocumentType.NOTA_CREDITO,
          refundId: 'rf1',
          idempotencyKey: 'credit-note:rf1',
          requestSnapshot: noteSnapshot,
          referenceDocument: {
            id: 'td-boleta',
            status: TaxDocumentStatus.ISSUED,
            folio: 734085,
            requestSnapshot: boletaSnapshot,
          },
        }),
        { emit: { ...accepted, folio: 122605 } },
      );

      await ctx.service.processOne('td-nc');

      expect(ctx.provider.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: { folio: 734085, issueDate: '2026-11-19' },
        }),
      );
      expect(ctx.refundSync.markIssued).toHaveBeenCalledWith(
        'rf1',
        122605,
        expect.anything(),
      );
    });
  });

  describe('failures', () => {
    it('keeps the document PENDING with exponential backoff on a retryable error', async () => {
      const ctx = build(doc({ attempts: 2 }), { emit: failure(true) });

      await ctx.service.processOne('td-1');

      const update = lastUpdate(ctx);
      expect(update.where).toMatchObject({ status: TaxDocumentStatus.PENDING });
      expect(update.data).toMatchObject({
        attempts: 3,
        lastError: '[NETWORK] timeout',
      });
      expect(update.data.status).toBeUndefined();
      expect((update.data.nextAttemptAt as Date).toISOString()).toBe(
        '2026-11-19T15:02:00.000Z',
      );
      expect(ctx.audit.record).not.toHaveBeenCalled();
    });

    it('rejects the document on a permanent error', async () => {
      const ctx = build(doc(), { emit: failure(false) });

      await ctx.service.processOne('td-1');

      expect(lastUpdate(ctx).data).toMatchObject({
        status: TaxDocumentStatus.REJECTED,
        nextAttemptAt: null,
        lastError: '[OF-10] MntNeto: Monto erroneo',
      });
      expect(ctx.audit.record).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ action: 'TAX_DOCUMENT_REJECTED' }),
      );
    });

    it('stays PENDING without next attempt once the max attempts are used', async () => {
      const ctx = build(doc({ attempts: 7 }), {
        emit: failure(true),
        maxAttempts: 8,
      });

      await ctx.service.processOne('td-1');

      const update = lastUpdate(ctx);
      expect(update.data.status).toBeUndefined();
      expect(update.data).toMatchObject({ attempts: 8, nextAttemptAt: null });
      expect(update.data.lastError).toContain('NETWORK');
      expect(ctx.audit.record).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ action: 'TAX_DOCUMENT_NEEDS_MANUAL_RETRY' }),
      );
    });

    it('records the account error on auth failures and keeps retrying', async () => {
      const ctx = build(doc(), {
        emit: failure(true, { auth: true, code: 'AUTH' }),
      });

      await ctx.service.processOne('td-1');

      expect(ctx.accounts.recordFailure).toHaveBeenCalledWith(
        'acc-1',
        expect.stringContaining('AUTH'),
      );
      expect(lastUpdate(ctx).data.nextAttemptAt).toBeInstanceOf(Date);
    });

    it('retries later when the restaurant has no active account', async () => {
      const ctx = build(doc(), { credentials: false });

      await ctx.service.processOne('td-1');

      expect(ctx.provider.emit).not.toHaveBeenCalled();
      expect(lastUpdate(ctx).data.lastError).toContain('NO_ACTIVE_ACCOUNT');
    });

    it('treats a duplicated folio as retryable instead of crashing', async () => {
      const ctx = build(doc(), {
        markIssuedError: new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      });

      await ctx.service.processOne('td-1');

      expect(lastUpdate(ctx).data.lastError).toContain('DUPLICATE_FOLIO');
    });

    it('moves a token-less document outside the dedupe window to manual review without emitting', async () => {
      const ctx = build(
        doc({ createdAt: new Date('2026-11-18T10:00:00.000Z'), attempts: 2 }),
      );

      await ctx.service.processOne('td-1');

      expect(ctx.provider.emit).not.toHaveBeenCalled();
      expect(lastUpdate(ctx).data).toMatchObject({
        attempts: 3,
        lastError: 'REQUIRES_MANUAL_REVIEW_DEDUPE_WINDOW',
        nextAttemptAt: null,
      });
      expect(lastUpdate(ctx).data.status).toBeUndefined();
      expect(ctx.audit.record).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ action: 'TAX_DOCUMENT_NEEDS_MANUAL_RETRY' }),
      );
    });

    it('still polls the status of an old document that already has a token', async () => {
      const ctx = build(
        doc({
          createdAt: new Date('2026-11-18T10:00:00.000Z'),
          providerDocId: 'tok1',
        }),
      );

      await ctx.service.processOne('td-1');

      expect(ctx.provider.emit).not.toHaveBeenCalled();
      expect(ctx.provider.getStatus).toHaveBeenCalled();
    });

    it('resolves credentials for the environment pinned in the snapshot', async () => {
      const ctx = build(
        doc({
          requestSnapshot: { ...boletaSnapshot, environment: 'PRODUCTION' },
        }),
        { credentials: false },
      );

      await ctx.service.processOne('td-1');

      expect(ctx.accounts.resolveCredentials).toHaveBeenCalledWith(
        'rest-1',
        'PRODUCTION',
      );
      expect(ctx.provider.emit).not.toHaveBeenCalled();
      expect(lastUpdate(ctx).data.lastError).toContain('[NO_ACTIVE_ACCOUNT]');
      expect(lastUpdate(ctx).data.lastError).toContain('PRODUCTION');
    });

    it('rejects a document without a valid snapshot', async () => {
      const ctx = build(doc({ requestSnapshot: { nope: true } }));

      await ctx.service.processOne('td-1');

      expect(ctx.provider.emit).not.toHaveBeenCalled();
      expect(lastUpdate(ctx).data.status).toBe(TaxDocumentStatus.REJECTED);
    });
  });

  describe('provider status polling', () => {
    it('keeps polling while the provider reports Pendiente', async () => {
      const ctx = build(doc(), {
        status: {
          kind: 'STATE',
          state: 'PENDING',
          providerStatus: 'Pendiente',
          folio: null,
        },
      });

      await ctx.service.processOne('td-1');

      const update = lastUpdate(ctx);
      expect(update.data.status).toBeUndefined();
      expect(update.data).toMatchObject({
        providerStatus: 'Pendiente',
        folio: 734085,
      });
      expect(update.data.nextAttemptAt).toBeInstanceOf(Date);
    });

    it('marks REJECTED when the provider rejects the document', async () => {
      const ctx = build(doc(), {
        status: {
          kind: 'STATE',
          state: 'REJECTED',
          providerStatus: 'Rechazado',
          folio: null,
        },
      });

      await ctx.service.processOne('td-1');

      expect(lastUpdate(ctx).data).toMatchObject({
        status: TaxDocumentStatus.REJECTED,
        providerStatus: 'Rechazado',
      });
    });

    it('retries the status call when the provider is down, never rejecting', async () => {
      const ctx = build(doc(), {
        status: {
          kind: 'FAILED',
          retryable: false,
          code: 'HTTP_400',
          message: 'odd',
          auth: false,
          retryAfterMs: null,
        },
      });

      await ctx.service.processOne('td-1');

      expect(lastUpdate(ctx).data.status).toBeUndefined();
      expect(lastUpdate(ctx).data.nextAttemptAt).toBeInstanceOf(Date);
    });
  });

  describe('idempotent re-run', () => {
    it('does not emit again when the provider token is already stored', async () => {
      const ctx = build(
        doc({ providerDocId: 'tok1', folio: 734085, attempts: 1 }),
      );

      await ctx.service.processOne('td-1');

      expect(ctx.provider.emit).not.toHaveBeenCalled();
      expect(ctx.provider.getStatus).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'tok1' }),
      );
      expect(lastUpdate(ctx).data).toMatchObject({
        status: TaxDocumentStatus.ISSUED,
        folio: 734085,
        attempts: 2,
      });
    });

    it('ignores documents that are no longer PENDING', async () => {
      const ctx = build(doc({ status: TaxDocumentStatus.ISSUED }));

      await ctx.service.processOne('td-1');

      expect(ctx.provider.emit).not.toHaveBeenCalled();
      expect(ctx.prisma.taxDocument.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('dependency order', () => {
    const credit = (reference: unknown) =>
      doc({
        id: 'td-nc',
        type: TaxDocumentType.NOTA_CREDITO,
        refundId: 'rf1',
        requestSnapshot: noteSnapshot,
        referenceDocument: reference,
      });

    it('defers a credit note while the boleta is still PENDING without spending an attempt', async () => {
      const ctx = build(
        credit({
          id: 'td-boleta',
          status: TaxDocumentStatus.PENDING,
          folio: null,
          requestSnapshot: boletaSnapshot,
        }),
      );

      await ctx.service.processOne('td-nc');

      expect(ctx.provider.emit).not.toHaveBeenCalled();
      expect(ctx.prisma.taxDocument.update).toHaveBeenCalledWith({
        where: { id: 'td-nc' },
        data: { nextAttemptAt: new Date(NOW.getTime() + 60_000) },
      });
      expect(ctx.prisma.taxDocument.updateMany).not.toHaveBeenCalled();
    });

    it('rejects the credit note when the boleta was rejected', async () => {
      const ctx = build(
        credit({
          id: 'td-boleta',
          status: TaxDocumentStatus.REJECTED,
          folio: null,
          requestSnapshot: boletaSnapshot,
        }),
      );

      await ctx.service.processOne('td-nc');

      expect(ctx.provider.emit).not.toHaveBeenCalled();
      expect(lastUpdate(ctx).data).toMatchObject({
        status: TaxDocumentStatus.REJECTED,
      });
      expect(lastUpdate(ctx).data.lastError).toContain('REFERENCE_NOT_ISSUED');
    });

    it('rejects a credit note that has no reference at all', async () => {
      const ctx = build(credit(null));

      await ctx.service.processOne('td-nc');

      expect(lastUpdate(ctx).data.lastError).toContain('MISSING_REFERENCE');
    });
  });
});
