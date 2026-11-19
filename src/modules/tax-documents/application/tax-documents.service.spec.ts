import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Role,
  TaxDocumentStatus,
  TaxDocumentType,
} from '@prisma/client';
import type { AuditService } from '../../../common/audit/audit.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type { TaxDocumentProviderPort } from './ports/tax-document-provider.port';
import { TaxDocumentsService, nextReissueKey } from './tax-documents.service';
import type { TaxProviderAccountService } from './tax-provider-account.service';

const authUser = { profileId: 'staff-1' } as unknown as JwtPayload;
const meta = { ip: '1.1.1.1', userAgent: 'jest' };
const d = (value: number) => new Prisma.Decimal(value);

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'td-1',
    restaurantId: 'rest-1',
    branchId: 'br-1',
    billId: 'bill-1',
    refundId: null,
    paymentId: null,
    type: TaxDocumentType.BOLETA_AFECTA,
    status: TaxDocumentStatus.PENDING,
    folio: null,
    issuedAt: null,
    netAmount: d(8403),
    exemptAmount: d(0),
    vatAmount: d(1597),
    tipAmount: d(0),
    totalAmount: d(10000),
    referenceDocumentId: null,
    referenceCode: null,
    reason: null,
    provider: 'openfactura',
    providerDocId: null,
    providerStatus: null,
    attempts: 8,
    nextAttemptAt: null,
    lastAttemptAt: new Date('2026-11-19T15:00:00Z'),
    lastError: '[NETWORK] timeout',
    createdAt: new Date(),
    idempotencyKey: 'boleta:bill-1',
    receiverRut: null,
    receiverName: null,
    requestSnapshot: {},
    ...overrides,
  };
}

function build(
  document: ReturnType<typeof row> | null,
  options: { restaurantId?: string; forbidden?: boolean } = {},
) {
  const prisma = {
    taxDocument: {
      findMany: jest.fn().mockResolvedValue(document ? [document] : []),
      findUnique: jest.fn().mockResolvedValue(document),
      findUniqueOrThrow: jest.fn().mockResolvedValue(document),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const branchAccess = {
    ensureAccess: jest.fn(() =>
      options.forbidden
        ? Promise.reject(new ForbiddenException('sin permisos'))
        : Promise.resolve({
            staffUserId: 'staff-1',
            restaurantId: options.restaurantId ?? 'rest-1',
          }),
    ),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const accounts = {
    resolveCredentials: jest.fn().mockResolvedValue({
      accountId: 'acc-1',
      credentials: { apiKey: 'key-123456', environment: 'SANDBOX' },
    }),
  };
  const provider = {
    fetchPdf: jest
      .fn()
      .mockResolvedValue({ kind: 'PDF', data: Buffer.from('%PDF') }),
  };
  const service = new TaxDocumentsService(
    prisma as unknown as PrismaService,
    branchAccess as unknown as BranchAccessService,
    audit as unknown as AuditService,
    accounts as unknown as TaxProviderAccountService,
    provider as unknown as TaxDocumentProviderPort,
  );

  return { service, prisma, branchAccess, audit, accounts, provider };
}

describe('TaxDocumentsService.list', () => {
  it('lets admins, supervisors and cashiers read and scopes the query to the branch', async () => {
    const ctx = build(row());

    const result = await ctx.service.list(authUser, 'br-1', {
      billId: 'bill-1',
      status: TaxDocumentStatus.PENDING,
    });

    expect(ctx.branchAccess.ensureAccess).toHaveBeenCalledWith(
      authUser,
      'br-1',
      [Role.ADMIN, Role.SUPERVISOR, Role.CASHIER],
    );
    expect(ctx.prisma.taxDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          restaurantId: 'rest-1',
          branchId: 'br-1',
          billId: 'bill-1',
          status: TaxDocumentStatus.PENDING,
        },
        take: 50,
      }),
    );
    expect(result[0]).toMatchObject({
      id: 'td-1',
      status: 'PENDING',
      needsManualRetry: true,
      canRetry: true,
      hasPdf: false,
      pdfUrl: null,
      netAmount: '8403',
      lastError: '[NETWORK] timeout',
    });
  });

  it('rejects staff without access to the branch', async () => {
    const ctx = build(row(), { forbidden: true });

    await expect(ctx.service.list(authUser, 'br-1', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(ctx.prisma.taxDocument.findMany).not.toHaveBeenCalled();
  });

  it('exposes the pdf path only for issued documents', async () => {
    const ctx = build(
      row({
        status: TaxDocumentStatus.ISSUED,
        folio: 734085,
        providerDocId: 'tok1',
        nextAttemptAt: null,
      }),
    );

    const [issued] = await ctx.service.listForBill(authUser, 'br-1', 'bill-1');

    expect(issued).toMatchObject({
      hasPdf: true,
      pdfUrl: '/v1/tax-documents/td-1/pdf',
      folio: 734085,
      canRetry: false,
      needsManualRetry: false,
    });
  });
});

describe('TaxDocumentsService.retry', () => {
  it('requires ADMIN on the branch of the document, resets the attempts and audits', async () => {
    const ctx = build(row());

    await ctx.service.retry(authUser, 'td-1', meta);

    expect(ctx.branchAccess.ensureAccess).toHaveBeenCalledWith(
      authUser,
      'br-1',
      [Role.ADMIN],
    );
    const call = ctx.prisma.taxDocument.updateMany.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(call[0].data).toMatchObject({
      status: TaxDocumentStatus.PENDING,
      attempts: 0,
      lastError: null,
    });
    expect(call[0].data.nextAttemptAt).toBeInstanceOf(Date);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        action: 'TAX_DOCUMENT_RETRY_REQUESTED',
        entityId: 'td-1',
        actorStaffUserId: 'staff-1',
        ip: '1.1.1.1',
      }),
    );
  });

  it('allows retrying a rejected document that never reached the provider', async () => {
    const ctx = build(row({ status: TaxDocumentStatus.REJECTED }));

    await expect(
      ctx.service.retry(authUser, 'td-1', meta),
    ).resolves.toBeDefined();
  });

  it('refuses a rejected document the provider already issued, a scheduled one and an issued one', async () => {
    for (const overrides of [
      { status: TaxDocumentStatus.REJECTED, providerDocId: 'tok1' },
      { nextAttemptAt: new Date() },
      { status: TaxDocumentStatus.ISSUED },
    ]) {
      const ctx = build(row(overrides));

      await expect(
        ctx.service.retry(authUser, 'td-1', meta),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(ctx.audit.record).not.toHaveBeenCalled();
    }
  });

  it('answers 409 when the document changed in the meantime', async () => {
    const ctx = build(row());
    ctx.prisma.taxDocument.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      ctx.service.retry(authUser, 'td-1', meta),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('answers 404 for an unknown document and 403 for another restaurant', async () => {
    await expect(
      build(null).service.retry(authUser, 'td-1', meta),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      build(row(), { restaurantId: 'rest-2' }).service.retry(
        authUser,
        'td-1',
        meta,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('propagates a role failure without touching the document', async () => {
    const ctx = build(row(), { forbidden: true });

    await expect(
      ctx.service.retry(authUser, 'td-1', meta),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.prisma.taxDocument.updateMany).not.toHaveBeenCalled();
  });
});

describe('TaxDocumentsService.getPdf', () => {
  const issued = {
    status: TaxDocumentStatus.ISSUED,
    folio: 734085,
    providerDocId: 'tok1',
  };

  it('proxies the pdf of an issued document', async () => {
    const ctx = build(row(issued));

    const pdf = await ctx.service.getPdf(authUser, 'td-1');

    expect(pdf.fileName).toBe('boleta_afecta-734085.pdf');
    expect(pdf.data.toString()).toBe('%PDF');
    expect(ctx.provider.fetchPdf).toHaveBeenCalledWith({
      credentials: { apiKey: 'key-123456', environment: 'SANDBOX' },
      token: 'tok1',
    });
  });

  it('refuses documents that are not issued yet', async () => {
    const ctx = build(row());

    await expect(ctx.service.getPdf(authUser, 'td-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('answers 502 when the provider cannot return the pdf', async () => {
    const ctx = build(row(issued));
    ctx.provider.fetchPdf.mockResolvedValue({
      kind: 'FAILED',
      retryable: true,
      code: 'NETWORK',
      message: 'x',
      auth: false,
      retryAfterMs: null,
    });

    await expect(ctx.service.getPdf(authUser, 'td-1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('answers 409 when the provider is not active anymore', async () => {
    const ctx = build(row(issued));
    ctx.accounts.resolveCredentials.mockResolvedValue(null);

    await expect(ctx.service.getPdf(authUser, 'td-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('TaxDocumentsService.retry edge cases', () => {
  it('refuses a token-less document outside the dedupe window', async () => {
    const ctx = build(
      row({ createdAt: new Date(Date.now() - 25 * 3_600_000) }),
    );

    await expect(
      ctx.service.retry(authUser, 'td-1', meta),
    ).rejects.toMatchObject({
      response: { code: 'TAX_DOCUMENT_REQUIRES_MANUAL_REVIEW' },
    });
    expect(ctx.prisma.taxDocument.updateMany).not.toHaveBeenCalled();
  });

  it('rebuilds the emitter from the restaurant after MISSING_FISCAL_DATA', async () => {
    const snapshot = {
      version: 1,
      kind: 'BOLETA',
      emitter: { rut: null },
      totals: { gross: 10000 },
    };
    const ctx = build(
      row({
        status: TaxDocumentStatus.REJECTED,
        lastError: '[MISSING_FISCAL_DATA] falta giro',
        requestSnapshot: snapshot,
      }),
    );
    (ctx.prisma as Record<string, unknown>).restaurant = {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        taxId: '76795561-8',
        legalName: null,
        name: 'Demo',
        businessActivity: 'Restaurantes',
        economicActivityCode: 561000,
        legalAddress: 'Calle 1',
        legalCommune: 'Santiago',
        legalCity: null,
      }),
    };

    await ctx.service.retry(authUser, 'td-1', meta);

    const call = ctx.prisma.taxDocument.updateMany.mock.calls[0] as [
      { data: { requestSnapshot: Record<string, unknown> } },
    ];
    expect(call[0].data.requestSnapshot).toMatchObject({
      totals: { gross: 10000 },
      emitter: {
        rut: '76795561-8',
        legalName: 'Demo',
        activity: 'Restaurantes',
      },
    });
  });
});

describe('nextReissueKey', () => {
  it('appends :2 and then increments', () => {
    expect(nextReissueKey('boleta:b1')).toBe('boleta:b1:2');
    expect(nextReissueKey('boleta:b1:2')).toBe('boleta:b1:3');
  });
});

describe('TaxDocumentsService.reissue', () => {
  const snapshot = {
    version: 1,
    kind: 'BOLETA',
    idempotencyKey: 'boleta:bill-1',
  };

  function buildReissue(overrides: Record<string, unknown>) {
    const ctx = build(row({ requestSnapshot: snapshot, ...overrides }));
    const tx = {
      restaurantTaxProviderAccount: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'acc-1', environment: 'PRODUCTION' }),
      },
      taxDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(row({ id: 'td-2' })),
      },
      restaurant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          timezone: 'America/Santiago',
          taxId: '76795561-8',
          legalName: 'Demo SpA',
          name: 'Demo',
          businessActivity: 'Restaurantes',
          economicActivityCode: 561000,
          legalAddress: 'Calle 1',
          legalCommune: 'Santiago',
          legalCity: null,
        }),
      },
    };
    (ctx.prisma as Record<string, unknown>).$transaction = jest.fn(
      (cb: (client: typeof tx) => Promise<unknown>) => cb(tx),
    );

    return { ...ctx, tx };
  }

  it('voids a remotely rejected boleta and enqueues a new one with a new key', async () => {
    const ctx = buildReissue({
      status: TaxDocumentStatus.REJECTED,
      providerDocId: 'tok1',
      nextAttemptAt: null,
    });

    const result = await ctx.service.reissue(authUser, 'td-1', meta);

    expect(ctx.tx.taxDocument.updateMany).toHaveBeenCalledWith({
      where: { id: 'td-1', status: 'REJECTED', nextAttemptAt: null },
      data: { status: TaxDocumentStatus.VOIDED, nextAttemptAt: null },
    });
    const created = ctx.tx.taxDocument.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(created[0].data).toMatchObject({
      idempotencyKey: 'boleta:bill-1:2',
      status: 'PENDING',
      requestSnapshot: expect.objectContaining({
        environment: 'PRODUCTION',
        idempotencyKey: 'boleta:bill-1:2',
      }),
    });
    expect(ctx.audit.record).toHaveBeenCalledWith(
      ctx.tx,
      expect.objectContaining({ action: 'TAX_DOCUMENT_REISSUED' }),
    );
    expect(result.id).toBe('td-2');
  });

  it('also allows documents parked for dedupe-window review', async () => {
    const ctx = buildReissue({
      lastError: 'REQUIRES_MANUAL_REVIEW_DEDUPE_WINDOW',
    });

    await expect(
      ctx.service.reissue(authUser, 'td-1', meta),
    ).resolves.toBeDefined();
  });

  it('refuses issued documents and credit notes', async () => {
    const issued = buildReissue({ status: TaxDocumentStatus.ISSUED });
    const note = buildReissue({
      status: TaxDocumentStatus.REJECTED,
      type: TaxDocumentType.NOTA_CREDITO,
    });

    await expect(
      issued.service.reissue(authUser, 'td-1', meta),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      note.service.reissue(authUser, 'td-1', meta),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
