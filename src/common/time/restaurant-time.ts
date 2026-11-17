const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_RESTAURANT_TIMEZONE = 'America/Santiago';

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function readZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

function zonedOffsetMs(date: Date, timeZone: string): number {
  const parts = readZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

const pad = (value: number): string => String(value).padStart(2, '0');

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function isDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function zonedDateKey(date: Date, timeZone: string): string {
  const parts = readZonedParts(date, timeZone);

  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const shifted = new Date(
    new Date(`${dateKey}T00:00:00.000Z`).getTime() + days * DAY_MS,
  );

  return shifted.toISOString().slice(0, 10);
}

export function daysBetweenDateKeys(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00.000Z`).getTime() -
      new Date(`${from}T00:00:00.000Z`).getTime()) /
      DAY_MS,
  );
}

export function zonedStartOfDay(dateKey: string, timeZone: string): Date {
  const wallClockAsUtc = new Date(`${dateKey}T00:00:00.000Z`).getTime();
  const firstGuess =
    wallClockAsUtc - zonedOffsetMs(new Date(wallClockAsUtc), timeZone);
  let instant = wallClockAsUtc - zonedOffsetMs(new Date(firstGuess), timeZone);

  while (zonedDateKey(new Date(instant), timeZone) < dateKey) {
    instant += HOUR_MS;
  }

  return new Date(instant);
}

export function formatZonedDateTime(date: Date, timeZone: string): string {
  const parts = readZonedParts(date, timeZone);

  return `${pad(parts.day)}-${pad(parts.month)}-${parts.year} ${pad(parts.hour)}:${pad(parts.minute)}`;
}
