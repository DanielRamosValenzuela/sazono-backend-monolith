import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  TaxDocumentStatus,
  TaxDocumentType,
  type TaxDocument,
} from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  DEDUPE_REVIEW_CODE,
  computeNextAttemptAt,
  isOutsideDedupeWindow,
} from '../domain/retry-policy';
import { isTaxSnapshot, type TaxSnapshot } from '../domain/tax-snapshot';
import { OPENFACTURA_PROVIDER_NAME } from '../infrastructure/openfactura/openfactura-tax-document.provider';
import { RefundCreditNoteSync } from '../infrastructure/refund-credit-note-sync';
import {
  TAX_DOCUMENT_PROVIDER,
  type ProviderFailure,
  type TaxDocumentProviderPort,
  type TaxProviderCredentials,
} from './ports/tax-document-provider.port';
import { TaxDocumentsConfigService } from './tax-documents-config.service';
import { TaxProviderAccountService } from './tax-provider-account.service';

const DEFER_REFERENCE_MS = 60_000;
const MAX_ERROR_LENGTH = 500;
const RECONCILE_BATCH = 50;

type DocumentWithReference = TaxDocument & {
  referenceDocument: {
    id: string;
    status: TaxDocumentStatus;
    folio: number | null;
    requestSnapshot: Prisma.JsonValue;
  } | null;
};

export type WorkerRunResult = { claimed: number; failed: number };

function formatError(code: string, message: string): string {
  return `[${code}] ${message}`.slice(0, MAX_ERROR_LENGTH);
}

@Injectable()
export class TaxDocumentWorkerService {
  private readonly logger = new Logger(TaxDocumentWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TaxDocumentsConfigService,
    private readonly accounts: TaxProviderAccountService,
    private readonly audit: AuditService,
    private readonly refundSync: RefundCreditNoteSync,
    @Inject(TAX_DOCUMENT_PROVIDER)
    private readonly provider: TaxDocumentProviderPort,
  ) {}

  async runOnce(): Promise<WorkerRunResult> {
    const ids = await this.claim();
    let failed = 0;

    for (const id of ids) {
      try {
        if (!(await this.renewLease(id))) {
          continue;
        }

        await this.processOne(id);
      } catch (error) {
        failed += 1;
        const message =
          error instanceof Error ? error.message : 'error desconocido';
        this.logger.error(
          `Fallo inesperado procesando el documento tributario ${id}: ${message}`,
        );
        await this.recordUnexpectedFailure(id, message);
      }
    }

    await this.reconcileRefundSync();

    return { claimed: ids.length, failed };
  }

  private async renewLease(id: string): Promise<boolean> {
    const result = await this.prisma.taxDocument.updateMany({
      where: { id, status: TaxDocumentStatus.PENDING },
      data: {
        nextAttemptAt: new Date(Date.now() + this.config.leaseSeconds * 1000),
        lastAttemptAt: new Date(),
      },
    });

    return result.count > 0;
  }

  private async recordUnexpectedFailure(
    id: string,
    message: string,
  ): Promise<void> {
    try {
      const doc = await this.prisma.taxDocument.findUnique({ where: { id } });

      if (doc && doc.status === TaxDocumentStatus.PENDING) {
        await this.retryLater(doc, doc.attempts + 1, {
          retryable: true,
          code: 'INTERNAL_ERROR',
          message,
          auth: false,
          retryAfterMs: null,
        });
      }
    } catch (error) {
      this.logger.error(
        `No se pudo registrar el fallo del documento ${id}: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }

  private async reconcileRefundSync(): Promise<void> {
    try {
      const stale = await this.prisma.taxDocument.findMany({
        where: {
          type: TaxDocumentType.NOTA_CREDITO,
          status: TaxDocumentStatus.ISSUED,
          refundId: { not: null },
          refund: { creditNoteStatus: { not: 'ISSUED' } },
        },
        select: { refundId: true, folio: true },
        take: RECONCILE_BATCH,
      });

      for (const row of stale) {
        if (row.refundId) {
          await this.refundSync.markIssued(row.refundId, row.folio);
        }
      }
    } catch (error) {
      this.logger.error(
        `No se pudo reconciliar notas de credito emitidas: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }

  async claim(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH due AS (
        SELECT td.id
        FROM tax_documents td
        WHERE td.status = 'PENDING'
          AND td.provider = ${OPENFACTURA_PROVIDER_NAME}
          AND td.next_attempt_at IS NOT NULL
          AND td.next_attempt_at <= now()
          AND (
            td.type <> 'NOTA_CREDITO'
            OR EXISTS (
              SELECT 1 FROM tax_documents ref
              WHERE ref.id = td.reference_document_id
                AND ref.status IN ('ISSUED', 'REJECTED', 'VOIDED')
            )
          )
        ORDER BY (td.type = 'NOTA_CREDITO') ASC, td.next_attempt_at ASC
        LIMIT ${this.config.batchSize}::int
        FOR UPDATE SKIP LOCKED
      )
      UPDATE tax_documents t
      SET next_attempt_at = now() + make_interval(secs => ${this.config.leaseSeconds}::double precision),
          last_attempt_at = now()
      FROM due
      WHERE t.id = due.id
      RETURNING t.id
    `);

    return rows.map((row) => row.id);
  }

  async processOne(id: string): Promise<void> {
    const doc = await this.prisma.taxDocument.findUnique({
      where: { id },
      include: {
        referenceDocument: {
          select: {
            id: true,
            status: true,
            folio: true,
            requestSnapshot: true,
          },
        },
      },
    });

    if (!doc || doc.status !== TaxDocumentStatus.PENDING) {
      return;
    }

    const snapshot = doc.requestSnapshot;

    if (!isTaxSnapshot(snapshot)) {
      await this.reject(
        doc,
        doc.attempts + 1,
        'INVALID_SNAPSHOT',
        'El documento no tiene un snapshot de emision valido.',
      );
      return;
    }

    const attempts = doc.attempts + 1;
    let reference: { folio: number; issueDate: string } | null = null;

    if (doc.type === TaxDocumentType.NOTA_CREDITO) {
      const resolved = await this.resolveReference(doc, snapshot, attempts);

      if (resolved === 'HANDLED') {
        return;
      }

      reference = resolved;
    }

    let resolvedAccount: Awaited<
      ReturnType<TaxProviderAccountService['resolveCredentials']>
    >;

    try {
      resolvedAccount = await this.accounts.resolveCredentials(
        doc.restaurantId,
        snapshot.environment,
      );
    } catch {
      await this.retryLater(doc, attempts, {
        retryable: true,
        code: 'CREDENTIALS_UNREADABLE',
        message: 'No se pudo descifrar la API key del proveedor.',
        auth: false,
        retryAfterMs: null,
      });
      return;
    }

    if (!resolvedAccount) {
      await this.retryLater(doc, attempts, {
        retryable: true,
        code: 'NO_ACTIVE_ACCOUNT',
        message: snapshot.environment
          ? `El restaurante no tiene un proveedor tributario activo en ${snapshot.environment}.`
          : 'El restaurante no tiene un proveedor tributario activo.',
        auth: false,
        retryAfterMs: null,
      });
      return;
    }

    const { credentials, accountId } = resolvedAccount;
    let token = doc.providerDocId;
    let folio = doc.folio;

    if (!token) {
      if (isOutsideDedupeWindow(doc.createdAt, new Date())) {
        await this.requireManualReview(doc, attempts);
        return;
      }

      const emitted = await this.provider.emit({
        credentials,
        snapshot,
        idempotencyKey: doc.idempotencyKey ?? doc.id,
        reference,
      });

      if (emitted.kind === 'FAILED') {
        await this.handleFailure(doc, attempts, emitted, accountId);
        return;
      }

      token = emitted.token;
      folio = emitted.folio ?? folio;
      await this.prisma.taxDocument.update({
        where: { id: doc.id },
        data: {
          providerDocId: token,
          folio,
          timbre: emitted.timbre,
          rawResponse: emitted.raw as Prisma.InputJsonObject,
          providerStatus: 'Emitido',
          provider: this.provider.providerName,
        },
      });
    }

    await this.settleRemoteState(doc, attempts, credentials, token, folio);
  }

  private async settleRemoteState(
    doc: TaxDocument,
    attempts: number,
    credentials: TaxProviderCredentials,
    token: string,
    knownFolio: number | null,
  ): Promise<void> {
    const status = await this.provider.getStatus({ credentials, token });

    if (status.kind === 'FAILED') {
      await this.retryLater(doc, attempts, { ...status, retryable: true });
      return;
    }

    const folio = status.folio ?? knownFolio;

    if (status.state === 'ISSUED') {
      await this.markIssued(doc, attempts, folio, status.providerStatus);
      return;
    }

    if (status.state === 'REJECTED') {
      await this.reject(
        doc,
        attempts,
        'REMOTE_REJECTED',
        `El proveedor informo el documento como ${status.providerStatus}.`,
        status.providerStatus,
      );
      return;
    }

    await this.retryLater(
      doc,
      attempts,
      {
        retryable: true,
        code: 'REMOTE_PENDING',
        message: `El proveedor informa el documento como ${status.providerStatus}.`,
        auth: false,
        retryAfterMs: null,
      },
      status.providerStatus,
      folio,
    );
  }

  private async resolveReference(
    doc: DocumentWithReference,
    snapshot: TaxSnapshot,
    attempts: number,
  ): Promise<{ folio: number; issueDate: string } | 'HANDLED'> {
    const reference = doc.referenceDocument;

    if (!reference) {
      await this.reject(
        doc,
        attempts,
        'MISSING_REFERENCE',
        'La nota de credito no tiene boleta de referencia.',
      );
      return 'HANDLED';
    }

    if (reference.status === TaxDocumentStatus.ISSUED && reference.folio) {
      const referenceSnapshot = reference.requestSnapshot;

      return {
        folio: reference.folio,
        issueDate: isTaxSnapshot(referenceSnapshot)
          ? referenceSnapshot.issueDate
          : snapshot.issueDate,
      };
    }

    if (reference.status === TaxDocumentStatus.PENDING) {
      await this.prisma.taxDocument.update({
        where: { id: doc.id },
        data: { nextAttemptAt: new Date(Date.now() + DEFER_REFERENCE_MS) },
      });
      return 'HANDLED';
    }

    await this.reject(
      doc,
      attempts,
      'REFERENCE_NOT_ISSUED',
      'La boleta de referencia no fue emitida, no se puede emitir la nota de credito.',
    );
    return 'HANDLED';
  }

  private async handleFailure(
    doc: TaxDocument,
    attempts: number,
    failure: ProviderFailure,
    accountId: string,
  ): Promise<void> {
    if (failure.auth) {
      await this.accounts.recordFailure(
        accountId,
        formatError(failure.code, failure.message),
      );
    }

    if (!failure.retryable) {
      await this.reject(doc, attempts, failure.code, failure.message);
      return;
    }

    await this.retryLater(doc, attempts, failure);
  }

  private async requireManualReview(
    doc: TaxDocument,
    attempts: number,
  ): Promise<void> {
    const result = await this.prisma.taxDocument.updateMany({
      where: { id: doc.id, status: TaxDocumentStatus.PENDING },
      data: {
        attempts,
        lastAttemptAt: new Date(),
        lastError: DEDUPE_REVIEW_CODE,
        nextAttemptAt: null,
      },
    });

    if (result.count === 0) {
      return;
    }

    await this.audit.record(null, {
      restaurantId: doc.restaurantId,
      branchId: doc.branchId,
      actorStaffUserId: null,
      actorRole: null,
      action: 'TAX_DOCUMENT_NEEDS_MANUAL_RETRY',
      entityType: 'TaxDocument',
      entityId: doc.id,
      after: { attempts, code: DEDUPE_REVIEW_CODE },
    });
  }

  private async retryLater(
    doc: TaxDocument,
    attempts: number,
    failure: ProviderFailure,
    providerStatus?: string,
    folio?: number | null,
  ): Promise<void> {
    const now = new Date();
    const nextAttemptAt = computeNextAttemptAt(
      now,
      attempts,
      this.config.retryBaseMs,
      this.config.maxAttempts,
      failure.retryAfterMs ?? undefined,
    );

    await this.prisma.taxDocument.updateMany({
      where: { id: doc.id, status: TaxDocumentStatus.PENDING },
      data: {
        attempts,
        lastAttemptAt: now,
        lastError: formatError(failure.code, failure.message),
        nextAttemptAt,
        ...(providerStatus ? { providerStatus } : {}),
        ...(folio ? { folio } : {}),
      },
    });

    if (nextAttemptAt === null) {
      await this.audit.record(null, {
        restaurantId: doc.restaurantId,
        branchId: doc.branchId,
        actorStaffUserId: null,
        actorRole: null,
        action: 'TAX_DOCUMENT_NEEDS_MANUAL_RETRY',
        entityType: 'TaxDocument',
        entityId: doc.id,
        after: { attempts, code: failure.code },
      });
    }
  }

  private async reject(
    doc: TaxDocument,
    attempts: number,
    code: string,
    message: string,
    providerStatus?: string,
  ): Promise<void> {
    const now = new Date();
    const result = await this.prisma.taxDocument.updateMany({
      where: { id: doc.id, status: TaxDocumentStatus.PENDING },
      data: {
        status: TaxDocumentStatus.REJECTED,
        attempts,
        lastAttemptAt: now,
        lastError: formatError(code, message),
        nextAttemptAt: null,
        ...(providerStatus ? { providerStatus } : {}),
      },
    });

    if (result.count === 0) {
      return;
    }

    await this.audit.record(null, {
      restaurantId: doc.restaurantId,
      branchId: doc.branchId,
      actorStaffUserId: null,
      actorRole: null,
      action: 'TAX_DOCUMENT_REJECTED',
      entityType: 'TaxDocument',
      entityId: doc.id,
      after: { type: doc.type, code, attempts },
    });
  }

  private async markIssued(
    doc: TaxDocument,
    attempts: number,
    folio: number | null,
    providerStatus: string,
  ): Promise<void> {
    const now = new Date();

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.taxDocument.updateMany({
          where: { id: doc.id, status: TaxDocumentStatus.PENDING },
          data: {
            status: TaxDocumentStatus.ISSUED,
            attempts,
            folio,
            issuedAt: now,
            lastAttemptAt: now,
            lastError: null,
            nextAttemptAt: null,
            providerStatus,
          },
        });

        if (result.count === 0) {
          return false;
        }

        if (doc.type === TaxDocumentType.NOTA_CREDITO && doc.refundId) {
          await this.refundSync.markIssued(doc.refundId, folio, tx);
        }

        return true;
      });

      if (!updated) {
        return;
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await this.retryLater(doc, attempts, {
          retryable: true,
          code: 'DUPLICATE_FOLIO',
          message: 'El folio informado ya existe en otro documento.',
          auth: false,
          retryAfterMs: null,
        });
        return;
      }

      throw error;
    }

    await this.audit.record(null, {
      restaurantId: doc.restaurantId,
      branchId: doc.branchId,
      actorStaffUserId: null,
      actorRole: null,
      action: 'TAX_DOCUMENT_ISSUED',
      entityType: 'TaxDocument',
      entityId: doc.id,
      after: { type: doc.type, folio, attempts },
    });
  }
}
