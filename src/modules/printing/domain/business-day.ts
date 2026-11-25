export const DEFAULT_BUSINESS_DAY_START_HOUR = 4;
export const DEFAULT_TIMEZONE = 'America/Santiago';

function safeTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function localParts(instant: Date, timezone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(timezone),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const values: Record<string, number> = {};

  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

const two = (value: number): string => String(value).padStart(2, '0');

export function formatLocalDateTime(instant: Date, timezone: string): string {
  const p = localParts(instant, timezone);

  return `${two(p.day)}/${two(p.month)}/${p.year} ${two(p.hour)}:${two(p.minute)}`;
}

export function formatLocalTime(instant: Date, timezone: string): string {
  const p = localParts(instant, timezone);

  return `${two(p.hour)}:${two(p.minute)}`;
}

export function businessDateKey(
  instant: Date,
  timezone: string,
  startHour: number,
): string {
  const p = localParts(instant, timezone);
  const shifted = new Date(
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
      startHour * 3_600_000,
  );

  return shifted.toISOString().slice(0, 10);
}

export function formatDisplayNumber(printCode: string, seq: number): string {
  return `#${printCode}-${String(seq).padStart(3, '0')}`;
}
