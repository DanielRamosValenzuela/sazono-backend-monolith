import type { ReceiptDocument } from '../domain/receipt-document';

export type LayoutLine = {
  text: string;
  align: 'left' | 'center';
  bold: boolean;
  size: 1 | 2;
  kind: 'text' | 'cut' | 'qr';
};

export const ITEM_INDENT = 5;
export const CUT_LABEL = '(corte)';

export function wrapText(
  text: string,
  width: number,
  firstIndent: number,
  continuationIndent: number,
): string[] {
  const rows: string[] = [];
  let current = ' '.repeat(firstIndent);
  let currentHasWord = false;

  const flush = () => {
    rows.push(current);
    current = ' '.repeat(continuationIndent);
    currentHasWord = false;
  };

  for (const rawWord of text.split(' ').filter((w) => w.length > 0)) {
    let word = rawWord;

    for (;;) {
      const room = width - current.length;
      const needed = word.length + (currentHasWord ? 1 : 0);

      if (needed <= room) {
        current += (currentHasWord ? ' ' : '') + word;
        currentHasWord = true;
        break;
      }

      if (currentHasWord) {
        flush();
        continue;
      }

      const chunk = Math.max(room, 1);
      current += word.slice(0, chunk);
      word = word.slice(chunk);
      flush();

      if (word.length === 0) {
        break;
      }
    }
  }

  if (currentHasWord || rows.length === 0) {
    rows.push(current);
  }

  return rows;
}

export function justify(left: string, right: string, width: number): string[] {
  if (right.length === 0) {
    return [left];
  }

  if (left.length + 1 + right.length <= width) {
    return [left + ' '.repeat(width - left.length - right.length) + right];
  }

  return [left, ' '.repeat(Math.max(width - right.length, 0)) + right];
}

function plain(text: string, bold = false): LayoutLine {
  return { text, align: 'left', bold, size: 1, kind: 'text' };
}

function centered(text: string, size: 1 | 2, bold: boolean): LayoutLine {
  return { text, align: 'center', bold, size, kind: 'text' };
}

export function fitsDouble(text: string, columns: number): boolean {
  return text.length <= Math.floor(columns / 2);
}

export function layoutReceipt(
  doc: ReceiptDocument,
  columns: number,
): LayoutLine[] {
  const out: LayoutLine[] = [];
  const separator = plain('.'.repeat(columns));
  const stationHeader = `*** ${doc.header.station} ***`;

  if (doc.kind === 'VOID') {
    out.push(centered('*** ANULADO ***', 2, true));
    out.push(centered(stationHeader, 1, true));
  } else {
    out.push(
      fitsDouble(stationHeader, columns)
        ? centered(stationHeader, 2, true)
        : centered(stationHeader, 1, true),
    );
  }

  out.push(
    fitsDouble(doc.header.number, columns)
      ? centered(doc.header.number, 2, true)
      : centered(doc.header.number, 1, true),
  );

  for (const banner of doc.banners) {
    for (const row of wrapText(banner, columns, 0, 0)) {
      out.push(centered(row.trim(), 1, true));
    }
  }

  for (const row of justify(
    doc.meta.printedAtLabel,
    doc.meta.placeLabel,
    columns,
  )) {
    out.push(plain(row));
  }

  const customer = doc.meta.customerLabel
    ? `Cliente: ${doc.meta.customerLabel}`
    : '';
  const staff = doc.meta.staffLabel;
  const sideBySide =
    columns >= 42 && staff.length + 1 + customer.length <= columns;

  if (sideBySide) {
    if (staff.length > 0 || customer.length > 0) {
      for (const row of justify(staff, customer, columns)) {
        out.push(plain(row));
      }
    }
  } else {
    if (staff.length > 0) {
      for (const row of wrapText(staff, columns, 0, 0)) {
        out.push(plain(row));
      }
    }

    if (customer.length > 0) {
      for (const row of wrapText(customer, columns, 0, ITEM_INDENT)) {
        out.push(plain(row));
      }
    }
  }

  out.push(separator);

  if (doc.meta.orderNotes) {
    for (const row of wrapText(
      `NOTA PEDIDO: ${doc.meta.orderNotes}`,
      columns,
      0,
      0,
    )) {
      out.push(plain(row, true));
    }

    out.push(separator);
  }

  for (const line of doc.lines) {
    for (const row of wrapText(
      `${line.qty} x ${line.name}`,
      columns,
      0,
      ITEM_INDENT,
    )) {
      out.push(plain(row));
    }

    for (const option of line.options) {
      for (const row of wrapText(
        option,
        columns,
        ITEM_INDENT,
        ITEM_INDENT + 2,
      )) {
        out.push(plain(row));
      }
    }

    if (line.note) {
      for (const row of wrapText(
        `* ${line.note}`,
        columns,
        ITEM_INDENT,
        ITEM_INDENT + 2,
      )) {
        out.push(plain(row));
      }
    }
  }

  out.push(separator);

  if (doc.footer.qrPayload) {
    out.push({
      text: doc.footer.qrPayload,
      align: 'center',
      bold: false,
      size: 1,
      kind: 'qr',
    });
  }

  out.push({
    text: CUT_LABEL,
    align: 'left',
    bold: false,
    size: 1,
    kind: 'cut',
  });

  return out;
}
