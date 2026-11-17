import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from './report-cursor';

const ID = '11111111-1111-4111-8111-111111111111';
const raw = (value: string, id = ID): string =>
  Buffer.from(`${value}|${id}`).toString('base64url');

describe('report-cursor', () => {
  it.each([
    ['timestamp', '2026-07-16T03:30:00.123Z'],
    ['number', '10000.50'],
    ['number', '0'],
    ['number', '-250.00'],
    ['text', '0000000042'],
    ['text', 'A1B2C3'],
  ] as const)('round-trips a %s value %s', (kind, value) => {
    expect(decodeCursor(encodeCursor({ value, id: ID }), kind)).toEqual({
      value,
      id: ID,
    });
  });

  it('keeps the legacy closedAt format: an ISO date and an id', () => {
    expect(decodeCursor(raw('2026-07-16T03:30:00.000Z'))).toEqual({
      value: '2026-07-16T03:30:00.000Z',
      id: ID,
    });
  });

  it('returns null without a cursor', () => {
    expect(decodeCursor(undefined, 'number')).toBeNull();
    expect(decodeCursor('', 'text')).toBeNull();
  });

  it.each([
    ['timestamp', 'not-a-date'],
    ['timestamp', '12000.00'],
    ['number', '2026-07-16T03:30:00.000Z'],
    ['number', '1e9'],
    ['number', '10.555'],
    ['number', '1; DROP TABLE bills; --'],
    ['text', 'abc123'],
    ['text', '12345678901'],
    ['text', "A'B"],
  ] as const)('rejects a %s cursor carrying %s', (kind, value) => {
    expect(() => decodeCursor(raw(value), kind)).toThrow(BadRequestException);
  });

  it('rejects malformed ids and extra segments', () => {
    expect(() =>
      decodeCursor(raw('2026-07-16T03:30:00.000Z', 'not-a-uuid')),
    ).toThrow(BadRequestException);
    expect(() =>
      decodeCursor(
        Buffer.from(`2026-07-16T03:30:00.000Z|${ID}|extra`).toString(
          'base64url',
        ),
      ),
    ).toThrow(BadRequestException);
  });
});
