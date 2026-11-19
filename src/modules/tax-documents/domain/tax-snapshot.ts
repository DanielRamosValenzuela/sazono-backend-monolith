export const TAX_SNAPSHOT_VERSION = 1;
export const MAX_ITEM_NAME_LENGTH = 80;
export const FALLBACK_ITEM_NAME = 'Consumo restaurante';
export const CREDIT_NOTE_ITEM_NAME = 'Devolucion de consumo';
export const CREDIT_NOTE_REFERENCE_CANCEL = 1;
export const CREDIT_NOTE_REFERENCE_CORRECT_AMOUNT = 3;

export type SnapshotEmitter = {
  rut: string | null;
  legalName: string | null;
  activity: string | null;
  economicActivityCode: number | null;
  address: string | null;
  commune: string | null;
  city: string | null;
};

export type SnapshotReceiver = {
  rut: string;
  name: string | null;
};

export type SnapshotLine = {
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
};

export type SnapshotTotals = {
  gross: number;
  net: number;
  vat: number;
  exempt: number;
};

export type SnapshotEnvironment = 'SANDBOX' | 'PRODUCTION';

type SnapshotBase = {
  version: typeof TAX_SNAPSHOT_VERSION;
  environment?: SnapshotEnvironment;
  idempotencyKey: string;
  issueDate: string;
  billId: string;
  billNumber: number | null;
  branch: { id: string; name: string };
  emitter: SnapshotEmitter;
  receiver: SnapshotReceiver | null;
  totals: SnapshotTotals;
  tip: number;
};

export type BoletaSnapshot = SnapshotBase & {
  kind: 'BOLETA';
  paymentMethod: string | null;
  lines: SnapshotLine[];
  discountTotal: number;
};

export type CreditNoteSnapshot = SnapshotBase & {
  kind: 'CREDIT_NOTE';
  refundId: string;
  reason: string;
  referenceCode: number;
  boletaTaxDocumentId: string;
};

export type TaxSnapshot = BoletaSnapshot | CreditNoteSnapshot;

export type SnapshotItemInput = {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discountAmount: number;
};

export type BoletaSnapshotInput = {
  idempotencyKey: string;
  issueDate: string;
  billId: string;
  billNumber: number | null;
  branch: { id: string; name: string };
  emitter: SnapshotEmitter;
  receiver?: SnapshotReceiver | null;
  paymentMethod: string | null;
  items: SnapshotItemInput[];
  consumption: number;
  net: number;
  vat: number;
  tip: number;
};

export type CreditNoteSnapshotInput = {
  idempotencyKey: string;
  issueDate: string;
  billId: string;
  billNumber: number | null;
  branch: { id: string; name: string };
  emitter: SnapshotEmitter;
  receiver?: SnapshotReceiver | null;
  refundId: string;
  reason: string;
  creditedConsumption: number;
  net: number;
  vat: number;
  tip: number;
  boletaTaxDocumentId: string;
  boletaTotal: number;
};

export type FiscalEmitterSource = {
  taxId: string | null;
  legalName: string | null;
  name: string;
  businessActivity: string | null;
  economicActivityCode: number | null;
  legalAddress: string | null;
  legalCommune: string | null;
  legalCity: string | null;
};

export function buildSnapshotEmitter(
  restaurant: FiscalEmitterSource,
): SnapshotEmitter {
  return {
    rut: restaurant.taxId,
    legalName: restaurant.legalName ?? restaurant.name,
    activity: restaurant.businessActivity,
    economicActivityCode: restaurant.economicActivityCode,
    address: restaurant.legalAddress,
    commune: restaurant.legalCommune,
    city: restaurant.legalCity,
  };
}

export function roundClp(value: number): number {
  return Math.round(value);
}

export function sanitizeItemName(raw: string): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();

  if (cleaned.length === 0) {
    return 'Item';
  }

  return cleaned.slice(0, MAX_ITEM_NAME_LENGTH);
}

function normalizeLine(item: SnapshotItemInput): SnapshotLine | null {
  const discount = roundClp(item.discountAmount);
  const gross = roundClp(item.totalPrice);
  const total = gross - discount;

  if (total <= 0 || item.quantity <= 0) {
    return null;
  }

  const exactUnit =
    Number.isInteger(item.unitPrice) &&
    Number.isInteger(item.quantity) &&
    item.unitPrice * item.quantity === gross;

  if (exactUnit) {
    return {
      name: sanitizeItemName(item.description),
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount,
      total,
    };
  }

  return {
    name: sanitizeItemName(item.description),
    quantity: 1,
    unitPrice: gross,
    discount,
    total,
  };
}

export function buildBoletaLines(
  items: SnapshotItemInput[],
  consumption: number,
): SnapshotLine[] {
  const lines = items
    .map(normalizeLine)
    .filter((line): line is SnapshotLine => line !== null);
  const sum = lines.reduce((acc, line) => acc + line.total, 0);

  if (lines.length > 0 && sum === consumption) {
    return lines;
  }

  return [
    {
      name: FALLBACK_ITEM_NAME,
      quantity: 1,
      unitPrice: consumption,
      discount: 0,
      total: consumption,
    },
  ];
}

function assertTotals(gross: number, net: number, vat: number): void {
  if (!Number.isInteger(gross) || gross <= 0) {
    throw new Error('El monto del documento tributario debe ser mayor a cero.');
  }

  if (net + vat !== gross) {
    throw new Error('El neto mas el IVA no cuadran con el total.');
  }
}

export function buildBoletaSnapshot(
  input: BoletaSnapshotInput,
): BoletaSnapshot {
  const gross = roundClp(input.consumption);
  assertTotals(gross, input.net, input.vat);
  const lines = buildBoletaLines(input.items, gross);

  return {
    version: TAX_SNAPSHOT_VERSION,
    kind: 'BOLETA',
    idempotencyKey: input.idempotencyKey,
    issueDate: input.issueDate,
    billId: input.billId,
    billNumber: input.billNumber,
    branch: input.branch,
    emitter: input.emitter,
    receiver: input.receiver ?? null,
    paymentMethod: input.paymentMethod,
    lines,
    discountTotal: lines.reduce((acc, line) => acc + line.discount, 0),
    totals: { gross, net: input.net, vat: input.vat, exempt: 0 },
    tip: roundClp(input.tip),
  };
}

export function computeCreditNoteReferenceCode(
  creditedConsumption: number,
  boletaTotal: number,
): number {
  return creditedConsumption >= boletaTotal
    ? CREDIT_NOTE_REFERENCE_CANCEL
    : CREDIT_NOTE_REFERENCE_CORRECT_AMOUNT;
}

export function buildCreditNoteSnapshot(
  input: CreditNoteSnapshotInput,
): CreditNoteSnapshot {
  const gross = roundClp(input.creditedConsumption);
  assertTotals(gross, input.net, input.vat);

  return {
    version: TAX_SNAPSHOT_VERSION,
    kind: 'CREDIT_NOTE',
    idempotencyKey: input.idempotencyKey,
    issueDate: input.issueDate,
    billId: input.billId,
    billNumber: input.billNumber,
    branch: input.branch,
    emitter: input.emitter,
    receiver: input.receiver ?? null,
    refundId: input.refundId,
    reason: input.reason,
    referenceCode: computeCreditNoteReferenceCode(gross, input.boletaTotal),
    boletaTaxDocumentId: input.boletaTaxDocumentId,
    totals: { gross, net: input.net, vat: input.vat, exempt: 0 },
    tip: roundClp(input.tip),
  };
}

export function isTaxSnapshot(value: unknown): value is TaxSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { version?: unknown; kind?: unknown };

  return (
    candidate.version === TAX_SNAPSHOT_VERSION &&
    (candidate.kind === 'BOLETA' || candidate.kind === 'CREDIT_NOTE')
  );
}
