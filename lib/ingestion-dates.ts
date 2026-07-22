/**
 * Parses NGERS-style "DD/MM/YYYY - DD/MM/YYYY" into ISO date strings (YYYY-MM-DD).
 *
 * Whitespace around the "-" is optional ("DD/MM/YYYY-DD/MM/YYYY" also parses) —
 * upstream extraction does not always include it. Dates never contain "-"
 * themselves (only "/"), so splitting on the single hyphen is unambiguous.
 */
export function parseNgersDateRange(dateRange: string): { start: string; end: string } | null {
  const match = dateRange
    .trim()
    .match(/^(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})$/);
  if (!match) return null;

  const parseDate = (d: string): string | null => {
    const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
  };
  const start = parseDate(match[1]);
  const end = parseDate(match[2]);
  if (!start || !end) return null;
  return { start, end };
}

/** First day of the calendar month containing `isoDate` (YYYY-MM-DD). */
export function monthStartIso(isoDate: string): string {
  const [y, m] = isoDate.split('-');
  return `${y}-${m}-01`;
}
