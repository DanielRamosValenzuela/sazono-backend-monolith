import { BadRequestException } from '@nestjs/common';
import { csvCell, csvLine, csvStream } from './report-csv';
import { decodeCursor, encodeCursor } from './report-cursor';

const BOM = String.fromCharCode(0xfeff);

describe('report-csv', () => {
  it('quotes cells that contain the separator, quotes or line breaks', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('di "hola"')).toBe('"di ""hola"""');
    expect(csvCell('x\ny')).toBe('"x\ny"');
    expect(csvCell('plain')).toBe('plain');
  });

  it('renders null and undefined as empty and numbers as-is', () => {
    expect(csvLine([null, undefined, 12000, 'ok'])).toBe(';;12000;ok\r\n');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });

  it('emits the BOM once, before the header', async () => {
    async function* lines() {
      await Promise.resolve();
      yield ['a', 1];
      yield ['b', 2];
    }

    let text = '';

    for await (const chunk of csvStream(['H1', 'H2'], lines())) {
      text += String(chunk);
    }

    expect(text).toBe(BOM + 'H1;H2\r\na;1\r\nb;2\r\n');
    expect(text.indexOf(BOM)).toBe(0);
    expect(text.lastIndexOf(BOM)).toBe(0);
  });
});

describe('report-cursor', () => {
  it('round-trips a keyset cursor', () => {
    const cursor = {
      value: '2026-07-16T03:30:00.123Z',
      id: '11111111-1111-4111-8111-111111111111',
    };

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('rejects a tampered cursor', () => {
    expect(() => decodeCursor('bm90LWEtY3Vyc29y')).toThrow(BadRequestException);
    expect(() =>
      decodeCursor(
        Buffer.from('2026-07-16T03:30:00.000Z|x; DROP TABLE').toString(
          'base64url',
        ),
      ),
    ).toThrow(BadRequestException);
  });
});
