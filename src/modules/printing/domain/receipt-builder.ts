import { formatLocalDateTime } from './business-day';
import type { ReceiptDocument, ReceiptLine } from './receipt-document';

export type StationTicketSnapshotItem = {
  quantity: number;
  name: string;
  notes: string | null;
  options: string[];
};

export type StationTicketSnapshot = {
  stationName: string;
  displayNumber: string;
  sentAt: Date;
  timezone: string;
  isCounter: boolean;
  ticketNumber: number | null;
  tableCode: string;
  customerLabel: string | null;
  orderNotes: string | null;
  isQrOrder: boolean;
  staff: { firstName: string; lastName: string } | null;
  items: StationTicketSnapshotItem[];
};

export const QR_STAFF_LABEL = 'CLIENTE QR';

const ALLOWED_EXTRA = 'áéíóúüñÁÉÍÓÚÜÑ¿¡ªº°€àèìòùâêîôûäëïöçÇ';

export function sanitizeText(value: string): string {
  let out = '';

  for (const char of value.replace(/\s+/g, ' ').trim()) {
    const code = char.codePointAt(0) ?? 0;

    out +=
      (code >= 0x20 && code <= 0x7e) || ALLOWED_EXTRA.includes(char)
        ? char
        : '?';
  }

  return out;
}

function optionalText(value: string | null | undefined): string | null {
  const clean = value ? sanitizeText(value) : '';

  return clean.length > 0 ? clean : null;
}

export function formatStaffLabel(
  staff: { firstName: string; lastName: string } | null,
  isQrOrder: boolean,
): string {
  if (staff) {
    return sanitizeText(`${staff.lastName}, ${staff.firstName}`).toUpperCase();
  }

  return isQrOrder ? QR_STAFF_LABEL : '';
}

export function formatPlaceLabel(
  isCounter: boolean,
  ticketNumber: number | null,
  tableCode: string,
): string {
  if (isCounter) {
    return ticketNumber === null ? 'MOSTRADOR' : `#${ticketNumber}`;
  }

  return `MESA ${sanitizeText(tableCode)}`;
}

export function buildReceiptDocument(
  snapshot: StationTicketSnapshot,
  options: { copies?: number } = {},
): ReceiptDocument {
  const lines: ReceiptLine[] = snapshot.items.map((item) => ({
    qty: item.quantity,
    name: sanitizeText(item.name),
    options: item.options.map(sanitizeText).filter((o) => o.length > 0),
    note: optionalText(item.notes),
  }));

  return {
    v: 1,
    kind: 'COMANDA',
    copies: Math.max(1, options.copies ?? 1),
    header: {
      station: sanitizeText(snapshot.stationName),
      number: snapshot.displayNumber,
    },
    meta: {
      printedAtLabel: formatLocalDateTime(snapshot.sentAt, snapshot.timezone),
      createdAtIso: snapshot.sentAt.toISOString(),
      placeLabel: formatPlaceLabel(
        snapshot.isCounter,
        snapshot.ticketNumber,
        snapshot.tableCode,
      ),
      staffLabel: formatStaffLabel(snapshot.staff, snapshot.isQrOrder),
      customerLabel: optionalText(snapshot.customerLabel),
      orderNotes: optionalText(snapshot.orderNotes),
    },
    banners: [],
    lines,
    footer: { qrPayload: null },
  };
}

export function buildTestDocument(input: {
  printerName: string;
  now: Date;
  timezone: string;
}): ReceiptDocument {
  return {
    v: 1,
    kind: 'TEST',
    copies: 1,
    header: { station: sanitizeText(input.printerName), number: 'PRUEBA' },
    meta: {
      printedAtLabel: formatLocalDateTime(input.now, input.timezone),
      createdAtIso: input.now.toISOString(),
      placeLabel: 'MESA 1',
      staffLabel: 'CAJERO, PRUEBA',
      customerLabel: null,
      orderNotes: 'Hoja de prueba de impresion',
    },
    banners: [],
    lines: [
      {
        qty: 1,
        name: 'Acentos aeiou áéíóú ÁÉÍÓÚ',
        options: ['Enie > ñ Ñ ü Ü', 'Signos > ¿Que? ¡Hola!'],
        note: 'Texto 1234567890 con una nota larga para probar el corte de linea',
      },
    ],
    footer: { qrPayload: null },
  };
}

export type DeliveryBannerInput = {
  now: Date;
  attempts: number;
  retryUncertain: boolean;
  lateMinutes: number;
  manualRetry?: boolean;
};

export function withDeliveryBanners(
  doc: ReceiptDocument,
  input: DeliveryBannerInput,
): ReceiptDocument {
  if (doc.kind !== 'COMANDA') {
    return doc;
  }

  const extra: string[] = [];
  const created = new Date(doc.meta.createdAtIso);
  const isReprint = doc.banners.some((b) => b.startsWith('*** REIMPRESO'));

  if (
    !isReprint &&
    !input.manualRetry &&
    !Number.isNaN(created.getTime()) &&
    input.now.getTime() - created.getTime() > input.lateMinutes * 60_000
  ) {
    extra.push(`** ATRASADA, pedido ${doc.meta.printedAtLabel.slice(-5)} **`);
  }

  if (input.attempts > 1 && input.retryUncertain) {
    extra.push('(REINTENTO)');
  }

  return extra.length === 0
    ? doc
    : { ...doc, banners: [...doc.banners, ...extra] };
}

export function buildReprintDocument(
  original: ReceiptDocument,
  input: {
    reprintNumber: number;
    now: Date;
    timezone: string;
    byLabel: string;
  },
): ReceiptDocument {
  const kept: string[] = [];

  for (let i = 0; i < original.banners.length; i += 1) {
    if (original.banners[i].startsWith('*** REIMPRESO')) {
      i += 1;
    } else {
      kept.push(original.banners[i]);
    }
  }

  return {
    ...original,
    banners: [
      ...kept,
      `*** REIMPRESO #${input.reprintNumber} ***`,
      `${formatLocalDateTime(input.now, input.timezone)} ${sanitizeText(input.byLabel).toUpperCase()}`.trim(),
    ],
  };
}

export function buildVoidDocument(
  original: ReceiptDocument,
  input: {
    now: Date;
    timezone: string;
    reason: string | null;
    byLabel: string | null;
  },
): ReceiptDocument {
  const banners = [
    ...original.banners.filter((b) => !b.includes('REIMPRESO')),
    formatLocalDateTime(input.now, input.timezone),
  ];
  const reason = optionalText(input.reason);
  const by = optionalText(input.byLabel)?.toUpperCase() ?? null;

  if (reason) {
    banners.push(`Motivo: ${reason}`);
  }

  if (by) {
    banners.push(`Anulado por: ${by}`);
  }

  return { ...original, kind: 'VOID', copies: 1, banners };
}
