import {
  Prisma,
  TaxDocumentStatus,
  TaxProvider,
  TaxProviderAccountStatus,
  type TaxDocument,
  type TaxDocumentType,
} from '@prisma/client';
import type { TaxSnapshot, SnapshotEnvironment } from '../domain/tax-snapshot';
import { OPENFACTURA_PROVIDER_NAME } from '../infrastructure/openfactura/openfactura-tax-document.provider';

type AccountClient = Pick<
  Prisma.TransactionClient,
  'restaurantTaxProviderAccount'
>;
type DocumentClient = Pick<Prisma.TransactionClient, 'taxDocument'>;

export type EnqueueTaxDocumentInput = {
  restaurantId: string;
  branchId: string;
  billId: string;
  paymentId?: string | null;
  refundId?: string | null;
  type: TaxDocumentType;
  netAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  tipAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  referenceDocumentId?: string | null;
  referenceCode?: number | null;
  reason?: string | null;
  receiverRut?: string | null;
  receiverName?: string | null;
  snapshot: TaxSnapshot;
  environment: SnapshotEnvironment;
  idempotencyKey: string;
  now?: Date;
};

export function findActiveTaxProviderAccount(
  client: AccountClient,
  restaurantId: string,
) {
  return findActiveAccountWhere(client, { restaurantId });
}

export function findActiveTaxProviderAccountForBill(
  client: AccountClient,
  billId: string,
) {
  return findActiveAccountWhere(client, {
    restaurant: { branches: { some: { bills: { some: { id: billId } } } } },
  });
}

function findActiveAccountWhere(
  client: AccountClient,
  scope: Prisma.RestaurantTaxProviderAccountWhereInput,
) {
  return client.restaurantTaxProviderAccount.findFirst({
    where: {
      ...scope,
      provider: TaxProvider.OPENFACTURA,
      status: TaxProviderAccountStatus.ACTIVE,
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, environment: true },
  });
}

function buildTaxDocumentData(
  input: EnqueueTaxDocumentInput,
): Prisma.TaxDocumentUncheckedCreateInput {
  return {
    restaurantId: input.restaurantId,
    branchId: input.branchId,
    billId: input.billId,
    paymentId: input.paymentId ?? null,
    refundId: input.refundId ?? null,
    type: input.type,
    status: TaxDocumentStatus.PENDING,
    netAmount: input.netAmount,
    exemptAmount: new Prisma.Decimal(0),
    vatAmount: input.vatAmount,
    tipAmount: input.tipAmount,
    totalAmount: input.totalAmount,
    referenceDocumentId: input.referenceDocumentId ?? null,
    referenceCode: input.referenceCode ?? null,
    reason: input.reason ?? null,
    provider: OPENFACTURA_PROVIDER_NAME,
    receiverRut: input.receiverRut ?? null,
    receiverName: input.receiverName ?? null,
    requestSnapshot: {
      ...input.snapshot,
      environment: input.environment,
    },
    idempotencyKey: input.idempotencyKey,
    nextAttemptAt: input.now ?? new Date(),
  };
}

export function enqueueTaxDocument(
  client: DocumentClient,
  input: EnqueueTaxDocumentInput,
): Promise<TaxDocument> {
  return client.taxDocument.create({ data: buildTaxDocumentData(input) });
}

export async function enqueueTaxDocumentIfAbsent(
  client: DocumentClient,
  input: EnqueueTaxDocumentInput,
): Promise<void> {
  await client.taxDocument.createMany({
    data: [buildTaxDocumentData(input)],
    skipDuplicates: true,
  });
}
