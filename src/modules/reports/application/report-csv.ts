import { Readable } from 'node:stream';

const BOM = '\uFEFF';
const SEPARATOR = ';';
const LINE_BREAK = '\r\n';
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

export type CsvCell = string | number | null | undefined;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    return String(value);
  }

  const text = FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix))
    ? `'${value}`
    : value;

  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: CsvCell[]): string {
  return cells.map(csvCell).join(SEPARATOR) + LINE_BREAK;
}

export function csvStream(
  headers: string[],
  lines: AsyncIterable<CsvCell[]>,
): Readable {
  async function* generate(): AsyncGenerator<string> {
    yield BOM + csvLine(headers);

    for await (const cells of lines) {
      yield csvLine(cells);
    }
  }

  return Readable.from(generate(), { objectMode: false });
}
