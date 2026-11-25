export type Align = 'left' | 'center' | 'right';

export interface Cell {
  ch: string;
  bold: boolean;
  w: number;
  h: number;
}

export type Row =
  | { kind: 'text'; cells: Cell[]; align: Align }
  | { kind: 'cut'; partial: boolean }
  | { kind: 'drawer' };

export interface ParsedJob {
  rows: Row[];
  warnings: string[];
  columns: number;
}

const CP850_HIGH =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜø£Ø×ƒ' +
  'áíóúñÑªº¿®¬½¼¡«»' +
  '░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐' +
  '└┴┬├─┼ãÃ╚╔╩╦╠═╬¤' +
  'ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀' +
  'ÓßÔÒõÕµþÞÚÛÙýݯ´' +
  '­±‗¾¶§÷¸°¨·¹³²■ ';

const WINDOWS_1252 = new TextDecoder('windows-1252');
const ESC_T_WINDOWS_1252 = 16;

function decodeByte(byte: number, codepage: number): string {
  if (byte < 0x80) {
    return String.fromCharCode(byte);
  }
  if (codepage === ESC_T_WINDOWS_1252) {
    return WINDOWS_1252.decode(Uint8Array.of(byte));
  }
  return CP850_HIGH[byte - 0x80];
}

const ALIGNS: Align[] = ['left', 'center', 'right'];

export function parseEscpos(bytes: Uint8Array, columns = 48): ParsedJob {
  const rows: Row[] = [];
  const warnings: string[] = [];
  let cells: Cell[] = [];
  let used = 0;
  let align: Align = 'left';
  let bold = false;
  let w = 1;
  let h = 1;
  let codepage = 19;

  const flush = (): void => {
    rows.push({ kind: 'text', cells, align });
    cells = [];
    used = 0;
  };

  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0x1b) {
      const c = bytes[i + 1];
      if (c === 0x40) {
        bold = false;
        w = 1;
        h = 1;
        align = 'left';
        codepage = 19;
        i += 2;
      } else if (c === 0x74) {
        codepage = bytes[i + 2];
        i += 3;
      } else if (c === 0x45) {
        bold = (bytes[i + 2] & 1) === 1;
        i += 3;
      } else if (c === 0x61) {
        const n = bytes[i + 2];
        align = ALIGNS[n >= 48 ? n - 48 : n] ?? 'left';
        i += 3;
      } else if (c === 0x70) {
        rows.push({ kind: 'drawer' });
        i += 5;
      } else if (c === 0x64) {
        if (cells.length > 0) {
          flush();
        }
        for (let k = 0; k < bytes[i + 2]; k++) {
          flush();
        }
        i += 3;
      } else {
        warnings.push(`unknown ESC 0x${(c ?? 0).toString(16)} at ${i}`);
        i += 2;
      }
    } else if (b === 0x1d) {
      const c = bytes[i + 1];
      if (c === 0x21) {
        const n = bytes[i + 2];
        w = ((n >> 4) & 7) + 1;
        h = (n & 7) + 1;
        i += 3;
      } else if (c === 0x56) {
        const m = bytes[i + 2];
        const feed = m === 65 || m === 66;
        if (cells.length > 0) {
          flush();
        }
        rows.push({ kind: 'cut', partial: m === 1 || m === 49 || m === 66 });
        i += feed ? 4 : 3;
      } else {
        warnings.push(`unknown GS 0x${(c ?? 0).toString(16)} at ${i}`);
        i += 2;
      }
    } else if (b === 0x0a) {
      flush();
      i += 1;
    } else if (b === 0x0d || b < 0x20) {
      i += 1;
    } else {
      if (used + w > columns && cells.length > 0) {
        flush();
      }
      cells.push({ ch: decodeByte(b, codepage), bold, w, h });
      used += w;
      i += 1;
    }
  }
  if (cells.length > 0) {
    flush();
  }
  return { rows, warnings, columns };
}

export function rowWidth(cells: Cell[]): number {
  return cells.reduce((sum, c) => sum + c.w, 0);
}

export function renderText(job: ParsedJob): string {
  const { columns } = job;
  return job.rows
    .map((row) => {
      if (row.kind === 'cut') {
        const label = row.partial ? ' corte parcial ' : ' corte ';
        const left = Math.floor((columns - label.length) / 2);
        return (
          '-'.repeat(left) + label + '-'.repeat(columns - left - label.length)
        );
      }
      if (row.kind === 'drawer') {
        return '[cajon]';
      }
      const text = row.cells.map((c) => c.ch).join('');
      const free = columns - rowWidth(row.cells);
      if (row.align === 'center') {
        return (' '.repeat(Math.floor(free / 2)) + text).trimEnd();
      }
      if (row.align === 'right') {
        return (' '.repeat(Math.max(free, 0)) + text).trimEnd();
      }
      return text.trimEnd();
    })
    .join('\n');
}
