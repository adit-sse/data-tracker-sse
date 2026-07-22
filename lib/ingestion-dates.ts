/**
 * Day and month may be one or two digits, and whitespace around the "-" is
 * optional. Upstream extraction is inconsistent about both, so all of these
 * describe the same range:
 *
 *   "01/07/2026 - 01/07/2026"
 *   "01/07/2026-01/07/2026"
 *   "1/7/2026-1/7/2026"
 *
 * Dates never contain "-" themselves (only "/"), so the single hyphen is
 * unambiguously the separator regardless of spacing.
 */
const NGERS_DATE_RANGE =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Day/month/year → YYYY-MM-DD, or null if the date does not exist.
 *
 * The calendar check matters: "31/02/2026" is well-formed but impossible, and
 * passing it through would build "2026-02-31" and fail at the database as a 500
 * rather than a clear 4xx here.
 */
function toIsoDate(day: string, month: string, year: string): string | null {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() + 1 !== m ||
    parsed.getUTCDate() !== d
  ) {
    return null;
  }
  return iso;
}

/** Parses a NGERS date range into ISO date strings (YYYY-MM-DD). */
export function parseNgersDateRange(dateRange: string): { start: string; end: string } | null {
  const match = (dateRange ?? '').trim().match(NGERS_DATE_RANGE);
  if (!match) return null;

  const start = toIsoDate(match[1], match[2], match[3]);
  const end = toIsoDate(match[4], match[5], match[6]);
  if (!start || !end) return null;

  return { start, end };
}

/** First day of the calendar month containing `isoDate` (YYYY-MM-DD). */
export function monthStartIso(isoDate: string): string {
  const [y, m] = isoDate.split('-');
  return `${y}-${m}-01`;
}
