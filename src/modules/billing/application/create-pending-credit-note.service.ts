import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  TaxDocumentStatus,
  TaxDocumentType,
  type Refund,
  type TaxDocument,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { zonedDateKey } from '../../../common/time/restaurant-time';
import {
  enqueueTaxDocumentIfAbsent,
  findActiveTaxProviderAccount,
} from '../../tax-documents/application/tax-documents-outbox';
import {
  buildCreditNoteSnapshot,
  isTaxSnapshot,
} from '../../tax-documents/domain/tax-snapshot';

export const CREDIT_NOTE_REFERENCE_CODE_CORRECT_AMOUNT = 3;

type Client = Pick<Prisma.TransactionClient, 'refund' | 'taxDocument'>;

@Injectable()
export class CreatePendingCreditNoteService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    refundId: string,
    client: Client = this.prisma,
  ): Promise<TaxDocument> {
    const existing = await client.taxDocument.findUnique({
      where: { refundId },
    });

    if (existing) {
      return existing;
    }

    const refund = await client.refund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        restaurantId: true,
        branchId: true,
        billId: true,
        paymentId: true,
        amount: true,
        tipAmount: true,
        netAmount: true,
        vatAmount: true,
        reasonText: true,
      },
    });

    if (!refund) {
      throw new NotFoundException('El reembolso no existe.');
    }

    const boleta = await client.taxDocument.findFirst({
      where: {
        billId: refund.billId,
        type: {
          in: [TaxDocumentType.BOLETA_AFECTA, TaxDocumentType.BOLETA_EXENTA],
        },
        status: TaxDocumentStatus.ISSUED,
      },
      orderBy: { issuedAt: 'desc' },
      select: { id: true },
    });

    return client.taxDocument.create({
      data: {
        restaurantId: refund.restaurantId,
        branchId: refund.branchId,
        billId: refund.billId,
        paymentId: refund.paymentId,
        refundId: refund.id,
        type: TaxDocumentType.NOTA_CREDITO,
        status: TaxDocumentStatus.PENDING,
        netAmount: refund.netAmount,
        exemptAmount: new Prisma.Decimal(0),
        vatAmount: refund.vatAmount,
        tipAmount: refund.tipAmount,
        totalAmount: refund.amount,
        referenceDocumentId: boleta?.id ?? null,
        referenceCode: boleta
          ? CREDIT_NOTE_REFERENCE_CODE_CORRECT_AMOUNT
          : null,
        reason: refund.reasonText,
      },
    });
  }
}

const logger = new Logger('EnqueueCreditNote');

export function creditNoteIdempotencyKey(refundId: string): string {
  return `credit-note:${refundId}`;
}

export type CreditNoteRefund = Pick<
  Refund,
  | 'id'
  | 'restaurantId'
  | 'branchId'
  | 'billId'
  | 'paymentId'
  | 'amount'
  | 'tipAmount'
  | 'netAmount'
  | 'vatAmount'
  | 'reasonText'
>;

type BoletaReferenceRow = {
  id: string;
  totalAmount: string;
  requestSnapshot: unknown;
  timezone: string;
};

export async function enqueueCreditNoteForRefund(
  tx: Prisma.TransactionClient,
  refundId: string,
  knownRefund?: CreditNoteRefund,
): Promise<void> {
  const refund =
    knownRefund ??
    (await tx.refund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        restaurantId: true,
        branchId: true,
        billId: true,
        paymentId: true,
        amount: true,
        tipAmount: true,
        netAmount: true,
        vatAmount: true,
        reasonText: true,
      },
    }));

  if (!refund) {
    return;
  }

  const consumption = refund.amount.sub(refund.tipAmount);

  if (consumption.lte(0)) {
    return;
  }

  const account = await findActiveTaxProviderAccount(tx, refund.restaurantId);

  if (!account) {
    return;
  }

  const [boleta] = await tx.$queryRaw<BoletaReferenceRow[]>`
    SELECT
      t.id,
      t.total_amount::text AS "totalAmount",
      t.request_snapshot AS "requestSnapshot",
      r.timezone
    FROM tax_documents t
    JOIN restaurants r ON r.id = t.restaurant_id
    WHERE t.bill_id = ${refund.billId}::uuid
      AND t.type = 'BOLETA_AFECTA'
      AND t.status IN ('PENDING', 'ISSUED')
    ORDER BY t.created_at DESC
    LIMIT 1
  `;
  const boletaSnapshot = boleta?.requestSnapshot;

  if (!boleta || !isTaxSnapshot(boletaSnapshot)) {
    return;
  }

  const idempotencyKey = creditNoteIdempotencyKey(refund.id);
  let snapshot: ReturnType<typeof buildCreditNoteSnapshot>;

  try {
    snapshot = buildCreditNoteSnapshot({
      idempotencyKey,
      issueDate: zonedDateKey(new Date(), boleta.timezone),
      billId: refund.billId,
      billNumber: boletaSnapshot.billNumber,
      branch: boletaSnapshot.branch,
      emitter: boletaSnapshot.emitter,
      receiver: boletaSnapshot.receiver,
      refundId: refund.id,
      reason: refund.reasonText,
      creditedConsumption: consumption.toNumber(),
      net: refund.netAmount.toNumber(),
      vat: refund.vatAmount.toNumber(),
      tip: refund.tipAmount.toNumber(),
      boletaTaxDocumentId: boleta.id,
      boletaTotal: Number(boleta.totalAmount),
    });
  } catch (error) {
    logger.error(
      `No se pudo encolar la nota de credito del reembolso ${refund.id}: ${
        error instanceof Error ? error.message : 'error desconocido'
      }`,
    );
    return;
  }

  await enqueueTaxDocumentIfAbsent(tx, {
    restaurantId: refund.restaurantId,
    branchId: refund.branchId,
    billId: refund.billId,
    paymentId: refund.paymentId,
    refundId: refund.id,
    type: TaxDocumentType.NOTA_CREDITO,
    netAmount: refund.netAmount,
    vatAmount: refund.vatAmount,
    tipAmount: refund.tipAmount,
    totalAmount: consumption,
    referenceDocumentId: boleta.id,
    referenceCode: snapshot.referenceCode,
    reason: refund.reasonText,
    snapshot,
    environment: account.environment,
    idempotencyKey,
  });
}
