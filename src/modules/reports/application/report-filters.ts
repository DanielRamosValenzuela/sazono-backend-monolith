import { BadRequestException } from '@nestjs/common';
import {
  BILL_PAYMENT_STATUSES,
  EMPTY_FILTERS,
  MAX_CATEGORY_PATH_DEPTH,
  MAX_FILTER_AMOUNT,
  MAX_PATH_SEGMENT_LENGTH,
  MAX_SEARCH_LENGTH,
  PAYMENT_SOURCES,
  type BillPaymentStatus,
  type PaymentSource,
  type ReportFilters,
} from './report-types';

export type RawReportFilters = {
  waiterId?: string;
  tableId?: string;
  zoneId?: string;
  source?: string;
  status?: string;
  minAmount?: number;
  maxAmount?: number;
  hasTip?: string;
  minTip?: number;
  timeFrom?: string;
  timeTo?: string;
  weekdays?: string;
  q?: string;
  productId?: string;
  productName?: string;
  categoryPath?: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const CATEGORY_SEPARATOR = '>';

function splitList(raw: string): string[] {
  return raw.split(',').map((value) => value.trim());
}

function parseUuid(raw: string | undefined, name: string): string | null {
  if (raw === undefined || raw === '') {
    return null;
  }

  if (!UUID_PATTERN.test(raw)) {
    throw new BadRequestException(`"${name}" debe ser un UUID valido.`);
  }

  return raw;
}

function parseEnumList<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  label: string,
): T[] {
  if (!raw) {
    return [];
  }

  const requested = splitList(raw);
  const invalid = requested.filter((value) => !allowed.includes(value as T));

  if (invalid.length > 0) {
    throw new BadRequestException(`${label} no valido: ${invalid.join(', ')}.`);
  }

  return [...new Set(requested as T[])];
}

function parseAmount(raw: number | undefined, name: string): number | null {
  if (raw === undefined || raw === null) {
    return null;
  }

  if (!Number.isInteger(raw) || raw < 0 || raw > MAX_FILTER_AMOUNT) {
    throw new BadRequestException(
      `"${name}" debe ser un entero entre 0 y ${MAX_FILTER_AMOUNT}.`,
    );
  }

  return raw;
}

function parseMinute(raw: string | undefined, name: string): number | null {
  if (!raw) {
    return null;
  }

  const match = TIME_PATTERN.exec(raw);

  if (!match) {
    throw new BadRequestException(`"${name}" debe tener el formato HH:mm.`);
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function parseWeekdays(raw: string | undefined): number[] {
  if (!raw) {
    return [];
  }

  const values = splitList(raw);

  if (!values.every((value) => /^[1-7]$/.test(value))) {
    throw new BadRequestException(
      '"weekdays" debe ser una lista de enteros 1 (lunes) a 7 (domingo).',
    );
  }

  return [...new Set(values.map(Number))].sort((a, b) => a - b);
}

function parseText(
  raw: string | undefined,
  name: string,
  maxLength: number,
): string | null {
  const text = raw?.trim() ?? '';

  if (text.length === 0) {
    return null;
  }

  if (text.length > maxLength) {
    throw new BadRequestException(
      `"${name}" no puede superar ${maxLength} caracteres.`,
    );
  }

  return text;
}

function parseCategoryPath(raw: string | undefined): string[] | null {
  if (!raw || raw.trim() === '') {
    return null;
  }

  const segments = raw.split(CATEGORY_SEPARATOR).map((value) => value.trim());

  if (
    segments.length > MAX_CATEGORY_PATH_DEPTH ||
    segments.some(
      (segment) =>
        segment.length === 0 || segment.length > MAX_PATH_SEGMENT_LENGTH,
    )
  ) {
    throw new BadRequestException(
      `"categoryPath" debe tener entre 1 y ${MAX_CATEGORY_PATH_DEPTH} niveles no vacios separados por ">".`,
    );
  }

  return segments;
}

function parseHasTip(raw: string | undefined): boolean | null {
  if (raw === undefined || raw === '') {
    return null;
  }

  if (raw !== 'true' && raw !== 'false') {
    throw new BadRequestException('"hasTip" debe ser true o false.');
  }

  return raw === 'true';
}

export function escapeLike(text: string): string {
  return text.replace(/[!%_]/g, (char) => `!${char}`);
}

export function parseReportFilters(raw: RawReportFilters): ReportFilters {
  const minAmount = parseAmount(raw.minAmount, 'minTotal/minAmount');
  const maxAmount = parseAmount(raw.maxAmount, 'maxTotal/maxAmount');
  const minTip = parseAmount(raw.minTip, 'minTip');
  const timeFromMinute = parseMinute(raw.timeFrom, 'timeFrom');
  const timeToMinute = parseMinute(raw.timeTo, 'timeTo');

  if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) {
    throw new BadRequestException('El monto minimo supera al maximo.');
  }

  const hasTip = parseHasTip(raw.hasTip);

  if (hasTip === false && minTip !== null && minTip > 0) {
    throw new BadRequestException('"minTip" contradice hasTip=false.');
  }

  return {
    ...EMPTY_FILTERS,
    waiterId: parseUuid(raw.waiterId, 'waiterId'),
    tableId: parseUuid(raw.tableId, 'tableId'),
    zoneId: parseUuid(raw.zoneId, 'zoneId'),
    sources: parseEnumList<PaymentSource>(
      raw.source,
      PAYMENT_SOURCES,
      'Origen',
    ),
    billStatuses: parseEnumList<BillPaymentStatus>(
      raw.status,
      BILL_PAYMENT_STATUSES,
      'Estado',
    ),
    minAmount,
    maxAmount,
    hasTip,
    minTip,
    timeFromMinute,
    timeToMinute,
    weekdays: parseWeekdays(raw.weekdays),
    q: parseText(raw.q, 'q', MAX_SEARCH_LENGTH),
    productId: parseUuid(raw.productId, 'productId'),
    productName: parseText(raw.productName, 'productName', 200),
    categoryPath: parseCategoryPath(raw.categoryPath),
  };
}
