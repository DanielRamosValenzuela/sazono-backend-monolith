import { BadRequestException } from '@nestjs/common';
import type { KeysetCursor } from './report-types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(`${cursor.at.toISOString()}|${cursor.id}`).toString(
    'base64url',
  );
}

export function decodeCursor(raw: string | undefined): KeysetCursor | null {
  if (!raw) {
    return null;
  }

  const [isoDate, id, ...rest] = Buffer.from(raw, 'base64url')
    .toString('utf8')
    .split('|');
  const at = new Date(isoDate ?? '');

  if (
    rest.length > 0 ||
    Number.isNaN(at.getTime()) ||
    !id ||
    !UUID_PATTERN.test(id)
  ) {
    throw new BadRequestException('El cursor de paginacion no es valido.');
  }

  return { at, id };
}
