import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Role,
  TaxDocumentStatus,
  TaxDocumentType,
} from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { zonedDateKey } from '../../../common/time/restaurant-time';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type {
  ListTaxDocumentsQueryDto,
  TaxDocumentResponseDto,
} from '../presentation/http/dto/tax-documents.dto';
import {
  TAX_DOCUMENT_PROVIDER,
  type TaxDocumentProviderPort,
} from './ports/tax-document-provider.port';
import {
  DEDUPE_REVIEW_CODE,
  isOutsideDedupeWindow,
} from '../domain/retry-policy';
import { buildSnapshotEmitter, isTaxSnapshot } from '../domain/tax-snapshot';
import { isRetryable, mapTaxDocument } from './tax-document-mapper';
import {
  enqueueTaxDocument,
  findActiveTaxProviderAccount,
} from './tax-documents-outbox';
import { TaxProviderAccountService } from './tax-provider-account.service';

export const TAX_DOCUMENT_READ_ROLES: Role[] = [
  Role.ADMIN,
  Role.SUPERVISOR,
  Role.CASHIER,
];
const DEFAULT_LIST_LIMIT = 50;
const MISSING_FISCAL_DATA_PREFIX = '[MISSING_FISCAL_DATA]';
const REISSUE_KEY_PATTERN = /^(.*?)(?::(\d+))?$/;

export function nextReissueKey(current: string): string {
  const match = REISSUE_KEY_PATTERN.exec(current);
  const base = match?.[1] ?? current;
  const suffix = match?.[2] ? Number(match[2]) : 1;

  return `${base}:${suffix + 1}`;
}

type RequestMeta = { ip: string | null; userAgent: string | null };

@Injectable()
export class TaxDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccess: BranchAccessService,
    private readonly audit: AuditService,
    private readonly accounts: TaxProviderAccountService,
    @Inject(TAX_DOCUMENT_PROVIDER)
    private readonly provider: TaxDocumentProviderPort,
  ) {}

  async list(
    authUser: JwtPayload,
    branchId: string,
    query: ListTaxDocumentsQueryDto,
  ): Promise<TaxDocumentResponseDto[]> {
    const context = await this.branchAccess.ensureAccess(
      authUser,
      branchId,
      TAX_DOCUMENT_READ_ROLES,
    );
    const documents = await this.prisma.taxDocument.findMany({
      where: {
        restaurantId: context.restaurantId,
        branchId,
        ...(query.billId ? { billId: query.billId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? DEFAULT_LIST_LIMIT,
    });

    return documents.map(mapTaxDocument);
  }

  listForBill(
    authUser: JwtPayload,
    branchId: string,
    billId: string,
  ): Promise<TaxDocumentResponseDto[]> {
    return this.list(authUser, branchId, { billId, limit: 100 });
  }

  async retry(
    authUser: JwtPayload,
    id: string,
    meta: RequestMeta,
  ): Promise<TaxDocumentResponseDto> {
    const doc = await this.loadForStaff(authUser, id, [Role.ADMIN]);

    if (!isRetryable(doc)) {
      throw new ConflictException({
        message: 'El documento no admite reintento manual en su estado actual.',
        code: 'TAX_DOCUMENT_NOT_RETRYABLE',
      });
    }

    const now = new Date();

    if (!doc.providerDocId && isOutsideDedupeWindow(doc.createdAt, now)) {
      throw new ConflictException({
        message:
          'El documento supero la ventana de idempotencia del proveedor: revisa el panel de OpenFactura y, si no existe, usa volver a emitir.',
        code: 'TAX_DOCUMENT_REQUIRES_MANUAL_REVIEW',
      });
    }

    let snapshotUpdate: { requestSnapshot: Prisma.InputJsonValue } | null =
      null;

    if (
      doc.lastError?.startsWith(MISSING_FISCAL_DATA_PREFIX) &&
      isTaxSnapshot(doc.requestSnapshot)
    ) {
      const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
        where: { id: doc.restaurantId },
        select: {
          taxId: true,
          legalName: true,
          name: true,
          businessActivity: true,
          economicActivityCode: true,
          legalAddress: true,
          legalCommune: true,
          legalCity: true,
        },
      });

      snapshotUpdate = {
        requestSnapshot: {
          ...doc.requestSnapshot,
          emitter: buildSnapshotEmitter(restaurant),
        } as Prisma.InputJsonValue,
      };
    }

    const result = await this.prisma.taxDocument.updateMany({
      where: {
        id: doc.id,
        status: doc.status,
        nextAttemptAt: null,
      },
      data: {
        status: TaxDocumentStatus.PENDING,
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        ...(snapshotUpdate ?? {}),
      },
    });

    if (result.count === 0) {
      throw new ConflictException({
        message: 'El documento cambio de estado, recarga e intenta de nuevo.',
        code: 'TAX_DOCUMENT_STATE_CHANGED',
      });
    }

    await this.audit.record(null, {
      restaurantId: doc.restaurantId,
      branchId: doc.branchId,
      actorStaffUserId: authUser.profileId,
      actorRole: Role.ADMIN,
      action: 'TAX_DOCUMENT_RETRY_REQUESTED',
      entityType: 'TaxDocument',
      entityId: doc.id,
      before: { status: doc.status, attempts: doc.attempts },
      after: { status: TaxDocumentStatus.PENDING },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const updated = await this.prisma.taxDocument.findUniqueOrThrow({
      where: { id: doc.id },
    });

    return mapTaxDocument(updated);
  }

  async reissue(
    authUser: JwtPayload,
    id: string,
    meta: RequestMeta,
  ): Promise<TaxDocumentResponseDto> {
    const doc = await this.loadForStaff(authUser, id, [Role.ADMIN]);
    const snapshot = doc.requestSnapshot;
    const inManualReview =
      doc.status === TaxDocumentStatus.PENDING &&
      doc.nextAttemptAt === null &&
      doc.lastError === DEDUPE_REVIEW_CODE;

    if (
      doc.type !== TaxDocumentType.BOLETA_AFECTA ||
      !isTaxSnapshot(snapshot) ||
      !doc.idempotencyKey ||
      (doc.status !== TaxDocumentStatus.REJECTED && !inManualReview)
    ) {
      throw new ConflictException({
        message: 'El documento no admite volver a emitir en su estado actual.',
        code: 'TAX_DOCUMENT_NOT_REISSUABLE',
      });
    }

    const idempotencyKey = nextReissueKey(doc.idempotencyKey);
    const fresh = await this.prisma.$transaction(async (tx) => {
      const account = await findActiveTaxProviderAccount(tx, doc.restaurantId);

      if (!account) {
        throw new ConflictException({
          message:
            'El proveedor tributario no esta activo para este restaurante.',
          code: 'TAX_PROVIDER_NOT_ACTIVE',
        });
      }

      const voided = await tx.taxDocument.updateMany({
        where: { id: doc.id, status: doc.status, nextAttemptAt: null },
        data: {
          status: TaxDocumentStatus.VOIDED,
          nextAttemptAt: null,
        },
      });

      if (voided.count === 0) {
        throw new ConflictException({
          message: 'El documento cambio de estado, recarga e intenta de nuevo.',
          code: 'TAX_DOCUMENT_STATE_CHANGED',
        });
      }

      const restaurant = await tx.restaurant.findUniqueOrThrow({
        where: { id: doc.restaurantId },
        select: {
          timezone: true,
          taxId: true,
          legalName: true,
          name: true,
          businessActivity: true,
          economicActivityCode: true,
          legalAddress: true,
          legalCommune: true,
          legalCity: true,
        },
      });
      const created = await enqueueTaxDocument(tx, {
        restaurantId: doc.restaurantId,
        branchId: doc.branchId,
        billId: doc.billId,
        paymentId: doc.paymentId,
        type: doc.type,
        netAmount: doc.netAmount,
        vatAmount: doc.vatAmount,
        tipAmount: doc.tipAmount,
        totalAmount: doc.totalAmount,
        receiverRut: doc.receiverRut,
        receiverName: doc.receiverName,
        snapshot: {
          ...snapshot,
          idempotencyKey,
          issueDate: zonedDateKey(new Date(), restaurant.timezone),
          emitter: buildSnapshotEmitter(restaurant),
        },
        environment: account.environment,
        idempotencyKey,
      });

      await this.audit.record(tx, {
        restaurantId: doc.restaurantId,
        branchId: doc.branchId,
        actorStaffUserId: authUser.profileId,
        actorRole: Role.ADMIN,
        action: 'TAX_DOCUMENT_REISSUED',
        entityType: 'TaxDocument',
        entityId: doc.id,
        before: { status: doc.status, lastError: doc.lastError },
        after: { status: TaxDocumentStatus.VOIDED, newDocumentId: created.id },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return created;
    });

    return mapTaxDocument(fresh);
  }

  async getPdf(
    authUser: JwtPayload,
    id: string,
  ): Promise<{ data: Buffer; fileName: string }> {
    const doc = await this.loadForStaff(authUser, id, TAX_DOCUMENT_READ_ROLES);

    if (doc.status !== TaxDocumentStatus.ISSUED || !doc.providerDocId) {
      throw new ConflictException({
        message: 'El documento aun no tiene PDF disponible.',
        code: 'TAX_DOCUMENT_PDF_NOT_AVAILABLE',
      });
    }

    const resolved = await this.accounts.resolveCredentials(doc.restaurantId);

    if (!resolved) {
      throw new ConflictException({
        message:
          'El proveedor tributario no esta activo para este restaurante.',
        code: 'TAX_PROVIDER_NOT_ACTIVE',
      });
    }

    const pdf = await this.provider.fetchPdf({
      credentials: resolved.credentials,
      token: doc.providerDocId,
    });

    if (pdf.kind === 'FAILED') {
      throw new BadGatewayException({
        message: 'No se pudo obtener el PDF desde el proveedor.',
        code: 'TAX_DOCUMENT_PDF_UNAVAILABLE',
      });
    }

    return {
      data: pdf.data,
      fileName: `${doc.type.toLowerCase()}-${doc.folio ?? doc.id}.pdf`,
    };
  }

  private async loadForStaff(authUser: JwtPayload, id: string, roles: Role[]) {
    const doc = await this.prisma.taxDocument.findUnique({ where: { id } });

    if (!doc) {
      throw new NotFoundException({
        message: 'El documento tributario no existe.',
        code: 'TAX_DOCUMENT_NOT_FOUND',
      });
    }

    const context = await this.branchAccess.ensureAccess(
      authUser,
      doc.branchId,
      roles,
    );

    if (context.restaurantId !== doc.restaurantId) {
      throw new ForbiddenException(
        'El documento no pertenece a tu restaurante.',
      );
    }

    return doc;
  }
}
