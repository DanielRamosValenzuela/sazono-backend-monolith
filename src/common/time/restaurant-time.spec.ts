import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  formatZonedDateTime,
  isDateKey,
  zonedDateKey,
  zonedStartOfDay,
} from './restaurant-time';

const SANTIAGO = 'America/Santiago';

describe('restaurant-time', () => {
  it('starts a summer day at 03:00Z (UTC-3) and a winter day at 04:00Z (UTC-4)', () => {
    expect(zonedStartOfDay('2026-01-15', SANTIAGO).toISOString()).toBe(
      '2026-01-15T03:00:00.000Z',
    );
    expect(zonedStartOfDay('2026-07-15', SANTIAGO).toISOString()).toBe(
      '2026-07-15T04:00:00.000Z',
    );
  });

  it('handles the daylight saving transition days', () => {
    const before = zonedStartOfDay('2026-09-05', SANTIAGO);
    const after = zonedStartOfDay('2026-09-07', SANTIAGO);

    expect(before.toISOString()).toBe('2026-09-05T04:00:00.000Z');
    expect(after.toISOString()).toBe('2026-09-07T03:00:00.000Z');
    expect(
      zonedDateKey(zonedStartOfDay('2026-09-06', SANTIAGO), SANTIAGO),
    ).toBe('2026-09-06');
  });

  it('keeps 23:30 Santiago on the same local day even though UTC is already the next day', () => {
    const lateSale = new Date('2026-07-16T03:30:00.000Z');

    expect(zonedDateKey(lateSale, SANTIAGO)).toBe('2026-07-15');
    expect(lateSale.getTime()).toBeLessThan(
      zonedStartOfDay('2026-07-16', SANTIAGO).getTime(),
    );
    expect(lateSale.getTime()).toBeGreaterThanOrEqual(
      zonedStartOfDay('2026-07-15', SANTIAGO).getTime(),
    );
  });

  it('formats dates as dd-MM-yyyy HH:mm in the restaurant timezone', () => {
    expect(
      formatZonedDateTime(new Date('2026-07-16T03:30:00.000Z'), SANTIAGO),
    ).toBe('15-07-2026 23:30');
  });

  it('validates and shifts date keys', () => {
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2026-02-28')).toBe(true);
    expect(isDateKey('2026-2-8')).toBe(false);
    expect(addDaysToDateKey('2026-02-28', 1)).toBe('2026-03-01');
    expect(daysBetweenDateKeys('2026-01-01', '2026-01-03')).toBe(2);
  });
});
