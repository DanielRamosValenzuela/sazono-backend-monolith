import { BadRequestException } from '@nestjs/common';
import type { KeysetCursor } from './report-types';

export type CursorValueKind = 'timestamp' | 'number' | 'text';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER_PATTERN = /^-?\d{1,12}(\.\d{1,2})?$/;
const TEXT_PATTERN = /^[0-9A-Z]{1,10}$/;

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(`${cursor.value}|${cursor.id}`).toString('base64url');
}

function normalizeValue(value: string, kind: CursorValueKind): string | null {
  if (kind === 'timestamp') {
    const at = new Date(value);

    return Number.isNaN(at.getTime()) ? null : at.toISOString();
  }

  const pattern = kind === 'number' ? NUMBER_PATTERN : TEXT_PATTERN;

  return pattern.test(value) ? value : null;
}

export function decodeCursor(
  raw: string | undefined,
  kind: CursorValueKind = 'timestamp',
): KeysetCursor | null {
  if (!raw) {
    return null;
  }

  const [value, id, ...rest] = Buffer.from(raw, 'base64url')
    .toString('utf8')
    .split('|');
  const normalized = normalizeValue(value ?? '', kind);

  if (rest.length > 0 || normalized === null || !id || !UUID_PATTERN.test(id)) {
    throw new BadRequestException('El cursor de paginacion no es valido.');
  }

  return { value: normalized, id };
}
