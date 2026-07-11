const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export { MINUTE_MS, HOUR_MS, DAY_MS };

export function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function endOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

export function localDayNumber(value) {
  const date = new Date(value);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

export function localDayDifference(later, earlier) {
  return localDayNumber(later) - localDayNumber(earlier);
}

export function sameLocalDay(a, b) {
  return localDayNumber(a) === localDayNumber(b);
}

export function addLocalDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

export function parseClock(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function formatClock(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) return null;
  const normalized = ((Math.trunc(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

export function minutesSinceLocalMidnight(value) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Equal quiet-hour boundaries mean "off", rather than a 24-hour quiet period.
 */
export function isInQuietHours(value, quietStart, quietEnd) {
  const start = parseClock(quietStart);
  const end = parseClock(quietEnd);
  if (start === null || end === null || start === end) return false;

  const minute = minutesSinceLocalMidnight(value);
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

export function atLocalTime(value, hour, minute = 0, second = 0, millisecond = 0) {
  const date = new Date(value);
  date.setHours(hour, minute, second, millisecond);
  return date.getTime();
}

export function validEpoch(value) {
  return Number.isFinite(value) && value >= 0;
}
