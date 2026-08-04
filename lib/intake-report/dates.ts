/**
 * Week maths for the data intake dashboard.
 *
 * Everything here is anchored to Australia/Perth, because that is the timezone
 * the n8n workflows run in (see the Schedule Trigger pinData: "Australia/Perth
 * (UTC+08:00)") and therefore the timezone the sheet's `Time` column is written
 * in. Perth has never observed DST, so a fixed +8 offset is correct — this is a
 * deliberate simplification, not an oversight, and it avoids pulling in
 * date-fns-tz for a single zone that cannot shift.
 *
 * A "week" is Monday 00:00:00.000 through Sunday 23:59:59.999 Perth time,
 * matching how the report titles itself ("Week ending Sunday 26 July 2026").
 * The n8n job instead uses a rolling `now - 7 days`, which is why its window
 * drifts by the job's runtime; ours does not.
 */

/** Perth is UTC+8 year-round. */
const PERTH_OFFSET_MS = 8 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/** 'YYYY-MM-DD' */
const WEEK_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `DD/MM/YYYY HH:MM` — the format the sheet standardises on.
 *
 * Day, month and hour are allowed to be unpadded because upstream extraction is
 * inconsistent about it (the same reason lib/ingestion-dates.ts is lenient).
 */
const DMY_TIME = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/;

/** `YYYY/MM/DD H:MM` — the other shape n8n's "Date normalise" node handles. */
const YMD_TIME = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/;

/**
 * Builds a UTC instant from Perth wall-clock parts, rejecting impossible dates.
 *
 * The calendar check matters: "31/02/2026" is well-formed but does not exist,
 * and letting it through would silently land the file in the wrong week rather
 * than being visibly dropped.
 */
function perthPartsToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const asUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const check = new Date(asUtc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  // The parts describe Perth wall-clock time; subtract the offset to get the
  // real instant.
  return new Date(asUtc - PERTH_OFFSET_MS);
}

/**
 * Parses the staging sheet's `Time` column into a real instant.
 *
 * Ported from the n8n "Date normalise" node, which reformats one string shape
 * into another and then string-splits it downstream. Returning a Date instead
 * removes a whole class of parsing bugs from the callers.
 *
 * Never hand these values to `new Date(string)` — the sheet is day-first, so
 * "01/07/2026" would parse as 7 January.
 */
export function parseSheetTime(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const ymd = trimmed.match(YMD_TIME);
  if (ymd) {
    return perthPartsToUtc(
      Number(ymd[1]), Number(ymd[2]), Number(ymd[3]),
      Number(ymd[4] ?? 0), Number(ymd[5] ?? 0),
    );
  }

  const dmy = trimmed.match(DMY_TIME);
  if (dmy) {
    return perthPartsToUtc(
      Number(dmy[3]), Number(dmy[2]), Number(dmy[1]),
      Number(dmy[4] ?? 0), Number(dmy[5] ?? 0),
    );
  }

  return null;
}

/**
 * Parses the ticket tracker's `Created Date`, which is a proper ISO timestamp
 * ("2026-07-13T23:30:09.853Z") rather than the staging sheet's day-first text.
 *
 * Kept separate from parseSheetTime on purpose: sharing one parser between the
 * two sheets would mean one of them is being guessed at.
 */
export function parseTicketCreatedDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/** Perth wall-clock parts for an instant. */
function perthParts(instant: Date): { year: number; month: number; day: number; dow: number } {
  const shifted = new Date(instant.getTime() + PERTH_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    dow: shifted.getUTCDay(), // 0 = Sunday
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** True when `key` is a well-formed 'YYYY-MM-DD' naming a real date. */
export function isWeekKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  const m = key.match(WEEK_KEY);
  if (!m) return false;
  return perthPartsToUtc(Number(m[1]), Number(m[2]), Number(m[3])) !== null;
}

/**
 * The Monday (Perth) of the week containing `instant`, as 'YYYY-MM-DD'.
 *
 * Weeks are keyed by their Monday rather than their Sunday because the Monday
 * is the range's lower bound — deriving the label from the key is easy, the
 * reverse invites off-by-one-day errors.
 */
export function weekKeyFor(instant: Date): string {
  const { year, month, day, dow } = perthParts(instant);
  // Sunday (0) is the *last* day of our week, so it is 6 days past Monday.
  const daysSinceMonday = (dow + 6) % 7;

  const mondayUtc = Date.UTC(year, month - 1, day) - daysSinceMonday * DAY_MS;
  const monday = new Date(mondayUtc);
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

/** Week key for the week currently in progress in Perth. */
export function currentWeekKey(): string {
  return weekKeyFor(new Date());
}

/** Moves a week key by whole weeks. `shiftWeek(k, -1)` is the previous week. */
export function shiftWeek(key: string, delta: number): string {
  const m = key.match(WEEK_KEY);
  if (!m) throw new Error(`Invalid week key: ${key}`);

  const shifted = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + delta * 7 * DAY_MS,
  );
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * Half-open-feeling but fully closed range: Monday 00:00:00.000 through Sunday
 * 23:59:59.999 Perth, as UTC instants.
 */
export function weekRangeFor(key: string): { start: Date; end: Date } {
  const m = key.match(WEEK_KEY);
  if (!m) throw new Error(`Invalid week key: ${key}`);

  const start = perthPartsToUtc(Number(m[1]), Number(m[2]), Number(m[3]));
  if (!start) throw new Error(`Invalid week key: ${key}`);

  return {
    start,
    end: new Date(start.getTime() + 7 * DAY_MS - 1),
  };
}

/** True when `instant` falls inside the week named by `key`. */
export function isInWeek(instant: Date, key: string): boolean {
  const { start, end } = weekRangeFor(key);
  const t = instant.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

/**
 * 'Week ending Sunday 26 July 2026'.
 *
 * Formatted by hand rather than via toLocaleDateString because this string is
 * generated on the server, where the runtime locale is not ours to assume.
 */
export function formatWeekEnding(key: string): string {
  const { end } = weekRangeFor(key);
  const { year, month, day, dow } = perthParts(end);
  return `Week ending ${DAY_NAMES[dow]} ${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

/** '20 Jul 2026' — compact Perth-local date for table cells. */
export function formatPerthDate(instant: Date): string {
  const { year, month, day } = perthParts(instant);
  return `${day} ${MONTH_NAMES[month - 1].slice(0, 3)} ${year}`;
}

/** Whole days between `instant` and now, floored at 0. */
export function ageInDays(instant: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - instant.getTime()) / DAY_MS));
}
