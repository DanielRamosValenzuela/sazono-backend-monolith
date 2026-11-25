import type { ReceiptDocument } from '../domain/receipt-document';
import { layoutReceipt, type LayoutLine } from './receipt-layout';

export function placeLine(line: LayoutLine, columns: number): string {
  if (line.align === 'center') {
    const left = Math.max(Math.floor((columns - line.text.length) / 2), 0);

    return ' '.repeat(left) + line.text;
  }

  return line.text;
}

export function renderText(doc: ReceiptDocument, columns: number): string {
  const copies = Math.max(doc.copies, 1);
  const lines = layoutReceipt(doc, columns).map((line) =>
    placeLine(
      line.kind === 'qr' ? { ...line, text: `[QR] ${line.text}` } : line,
      columns,
    ).trimEnd(),
  );
  const block = lines.join('\n');

  return Array.from({ length: copies }, () => block).join('\n');
}
