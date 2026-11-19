import { Logger } from '@nestjs/common';
import {
  BillStatus,
  Prisma,
  TaxDocumentType,
  type PaymentMethod,
} from '@prisma/client';
import { zonedDateKey } from '../../../common/time/restaurant-time';
import {
  enqueueTaxDocumentIfAbsent,
  findActiveTaxProviderAccountForBill,
} from '../../tax-documents/application/tax-documents-outbox';
import {
  buildBoletaSnapshot,
  buildSnapshotEmitter,
} from '../../tax-documents/domain/tax-snapshot';
import { computeBillTotals, computeVatBreakdown } from '../domain/tax-policy';

const logger = new Logger('EnqueueBoleta');

type BoletaRow = {
  id: string;
  number: number | null;
  status: string;
  branchId: string;
  subtotalAmount: string;
  discountAmount: string;
  tipAmount: string;
  branchName: string;
  restaurantId: string;
  timezone: string;
  taxId: string | null;
  legalName: string | null;
  restaurantName: string;
  businessActivity: string | null;
  legalAddress: string | null;
  legalCommune: string | null;
  legalCity: string | null;
  economicActivityCode: number | null;
  items: {
    description: string;
    quantity: number;
    unitPrice: string;
    totalPrice: string;
    discountAmount: string;
  }[];
  lastPayment: { id: string; method: PaymentMethod | null } | null;
};

export function boletaIdempotencyKey(billId: string): string {
  return `boleta:${billId}`;
}

export async function enqueueBoletaForPaidBill(
  tx: Prisma.TransactionClient,
  billId: string,
): Promise<void> {
  const account = await findActiveTaxProviderAccountForBill(tx, billId);

  if (!account) {
    return;
  }

  const [row] = await tx.$queryRaw<BoletaRow[]>`
    SELECT
      b.id,
      b.number,
      b.status::text AS status,
      b.branch_id AS "branchId",
      b.subtotal_amount::text AS "subtotalAmount",
      b.discount_amount::text AS "discountAmount",
      b.tip_amount::text AS "tipAmount",
      br.name AS "branchName",
      br.restaurant_id AS "restaurantId",
      r.timezone,
      r.tax_id AS "taxId",
      r.legal_name AS "legalName",
      r.name AS "restaurantName",
      r.business_activity AS "businessActivity",
      r.legal_address AS "legalAddress",
      r.legal_commune AS "legalCommune",
      r.legal_city AS "legalCity",
      r.economic_activity_code AS "economicActivityCode",
      (
        SELECT COALESCE(
          json_agg(
            json_build_object(
              'description', i.description,
              'quantity', i.quantity,
              'unitPrice', i.unit_price::text,
              'totalPrice', i.total_price::text,
              'discountAmount', i.discount_amount::text
            ) ORDER BY i.created_at ASC
          ),
          '[]'::json
        )
        FROM bill_items i
        WHERE i.bill_id = b.id AND i.status = 'OPEN'
      ) AS items,
      (
        SELECT json_build_object('id', p.id, 'method', p.method::text)
        FROM payments p
        WHERE p.bill_id = b.id AND p.status = 'PAID'
        ORDER BY p.paid_at DESC
        LIMIT 1
      ) AS "lastPayment"
    FROM bills b
    JOIN branches br ON br.id = b.branch_id
    JOIN restaurants r ON r.id = br.restaurant_id
    WHERE b.id = ${billId}::uuid
  `;

  if (!row || row.status !== BillStatus.PAID) {
    return;
  }

  const bill = {
    id: row.id,
    number: row.number,
    branchId: row.branchId,
    subtotalAmount: new Prisma.Decimal(row.subtotalAmount),
    discountAmount: new Prisma.Decimal(row.discountAmount),
    tipAmount: new Prisma.Decimal(row.tipAmount),
  };
  const restaurantId = row.restaurantId;
  const idempotencyKey = boletaIdempotencyKey(bill.id);

  const { consumptionAmount } = computeBillTotals(
    bill.subtotalAmount,
    bill.tipAmount,
    bill.discountAmount,
  );

  if (consumptionAmount.lte(0)) {
    return;
  }

  const items = row.items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unitPrice: new Prisma.Decimal(item.unitPrice),
    totalPrice: new Prisma.Decimal(item.totalPrice),
    discountAmount: new Prisma.Decimal(item.discountAmount),
  }));
  const lastPayment = row.lastPayment;
  const restaurant = {
    timezone: row.timezone,
    taxId: row.taxId,
    legalName: row.legalName,
    name: row.restaurantName,
    businessActivity: row.businessActivity,
    legalAddress: row.legalAddress,
    legalCommune: row.legalCommune,
    legalCity: row.legalCity,
    economicActivityCode: row.economicActivityCode,
  };
  const { netAmount, vatAmount } = computeVatBreakdown(consumptionAmount);

  let snapshot: ReturnType<typeof buildBoletaSnapshot>;

  try {
    snapshot = buildBoletaSnapshot({
      idempotencyKey,
      issueDate: zonedDateKey(new Date(), restaurant.timezone),
      billId: bill.id,
      billNumber: bill.number,
      branch: { id: bill.branchId, name: row.branchName },
      emitter: buildSnapshotEmitter(restaurant),
      paymentMethod: lastPayment?.method ?? null,
      items: items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toNumber(),
        totalPrice: item.totalPrice.toNumber(),
        discountAmount: item.discountAmount.toNumber(),
      })),
      consumption: consumptionAmount.toNumber(),
      net: netAmount.toNumber(),
      vat: vatAmount.toNumber(),
      tip: bill.tipAmount.toNumber(),
    });
  } catch (error) {
    logger.error(
      `No se pudo encolar la boleta de la cuenta ${bill.id}: ${
        error instanceof Error ? error.message : 'error desconocido'
      }`,
    );
    return;
  }

  await enqueueTaxDocumentIfAbsent(tx, {
    restaurantId,
    branchId: bill.branchId,
    billId: bill.id,
    paymentId: lastPayment?.id ?? null,
    type: TaxDocumentType.BOLETA_AFECTA,
    netAmount,
    vatAmount,
    tipAmount: bill.tipAmount,
    totalAmount: consumptionAmount,
    snapshot,
    environment: account.environment,
    idempotencyKey,
  });
}
