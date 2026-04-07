/** Parses NGERS-style "DD/MM/YYYY - DD/MM/YYYY" into ISO date strings (YYYY-MM-DD). */
export function parseNgersDateRange(dateRange: string): { start: string; end: string } | null {
  const parts = dateRange.split(' - ');
  if (parts.length !== 2) return null;
  const parseDate = (d: string): string | null => {
    const match = d.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    return `${match[3]}-${match[2]}-${match[1]}`;
  };
  const start = parseDate(parts[0]);
  const end = parseDate(parts[1]);
  if (!start || !end) return null;
  return { start, end };
}

/** First day of the calendar month containing `isoDate` (YYYY-MM-DD). */
export function monthStartIso(isoDate: string): string {
  const [y, m] = isoDate.split('-');
  return `${y}-${m}-01`;
}
