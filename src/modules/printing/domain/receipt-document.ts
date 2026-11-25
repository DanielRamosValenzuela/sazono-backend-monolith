export type ReceiptKind = 'COMANDA' | 'VOID' | 'TEST';

export type ReceiptLine = {
  qty: number;
  name: string;
  options: string[];
  note: string | null;
};

export type ReceiptDocument = {
  v: 1;
  kind: ReceiptKind;
  copies: number;
  header: { station: string; number: string };
  meta: {
    printedAtLabel: string;
    createdAtIso: string;
    placeLabel: string;
    staffLabel: string;
    customerLabel: string | null;
    orderNotes: string | null;
  };
  banners: string[];
  lines: ReceiptLine[];
  footer: { qrPayload: string | null };
};

export function isReceiptDocument(value: unknown): value is ReceiptDocument {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const doc = value as Partial<ReceiptDocument>;

  return (
    doc.v === 1 &&
    typeof doc.kind === 'string' &&
    !!doc.header &&
    typeof doc.header.station === 'string' &&
    typeof doc.header.number === 'string' &&
    !!doc.meta &&
    Array.isArray(doc.lines) &&
    Array.isArray(doc.banners)
  );
}
