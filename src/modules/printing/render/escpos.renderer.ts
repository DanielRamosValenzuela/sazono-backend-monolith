import type { ReceiptDocument } from '../domain/receipt-document';
import {
  ESC_T_IDS,
  encodeText,
  isCodepageName,
  type CodepageName,
} from './codepages';
import { layoutReceipt, type LayoutLine } from './receipt-layout';

export type EscPosOptions = {
  columns: number;
  codepage: string;
  escTCodepageId?: number | null;
  autoCut?: boolean;
  cashDrawer?: boolean;
  copies?: number;
};

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const alignBytes = (line: LayoutLine): number[] => [
  ESC,
  0x61,
  line.align === 'center' ? 1 : 0,
];

function qrBytes(payload: string): number[] {
  const data = encodeText(payload, 'windows1252');
  const length = data.length + 3;

  return [
    GS,
    0x28,
    0x6b,
    0x04,
    0x00,
    0x31,
    0x41,
    0x32,
    0x00,
    GS,
    0x28,
    0x6b,
    0x03,
    0x00,
    0x31,
    0x43,
    0x06,
    GS,
    0x28,
    0x6b,
    0x03,
    0x00,
    0x31,
    0x45,
    0x31,
    GS,
    0x28,
    0x6b,
    length & 0xff,
    length >> 8,
    0x31,
    0x50,
    0x30,
    ...data,
    GS,
    0x28,
    0x6b,
    0x03,
    0x00,
    0x31,
    0x51,
    0x30,
  ];
}

export function renderEscPos(
  doc: ReceiptDocument,
  options: EscPosOptions,
): Uint8Array {
  const codepage: CodepageName = isCodepageName(options.codepage)
    ? options.codepage
    : 'cp858';
  const escT = options.escTCodepageId ?? ESC_T_IDS[codepage];
  const copies = Math.max(options.copies ?? doc.copies, 1);
  const layout = layoutReceipt(doc, options.columns);
  const bytes: number[] = [];

  for (let copy = 0; copy < copies; copy += 1) {
    bytes.push(ESC, 0x40, ESC, 0x74, escT);

    if (options.cashDrawer && copy === 0) {
      bytes.push(ESC, 0x70, 0x00, 0x19, 0xfa);
    }

    for (const line of layout) {
      if (line.kind === 'cut') {
        if (options.autoCut === false) {
          bytes.push(ESC, 0x64, 0x04);
        } else {
          bytes.push(ESC, 0x64, 0x02, GS, 0x56, 0x42, 0x00);
        }

        continue;
      }

      bytes.push(...alignBytes(line));

      if (line.kind === 'qr') {
        bytes.push(...qrBytes(line.text), LF);
        continue;
      }

      bytes.push(ESC, 0x45, line.bold ? 1 : 0);
      bytes.push(GS, 0x21, line.size === 2 ? 0x11 : 0x00);
      bytes.push(...encodeText(line.text, codepage), LF);
      bytes.push(GS, 0x21, 0x00, ESC, 0x45, 0x00, ESC, 0x61, 0x00);
    }
  }

  return Uint8Array.from(bytes);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}
