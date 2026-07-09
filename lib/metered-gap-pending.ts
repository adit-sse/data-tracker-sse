import { addMonths, endOfMonth, format, parseISO, startOfMonth } from 'date-fns';

/** Every calendar month start (YYYY-MM-01) overlapping [periodStart, periodEnd] inclusive. */
export function eachMonthStartIsoOverlapping(periodStart: string, periodEnd: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let d = startOfMonth(parseISO(periodStart));
  const endMonth = startOfMonth(parseISO(periodEnd));
  while (d <= endMonth) {
    const key = format(d, 'yyyy-MM-dd');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
    d = addMonths(d, 1);
  }
  return out;
}

export function monthEndIsoFromMonthStart(monthStartIso: string): string {
  return format(endOfMonth(parseISO(monthStartIso)), 'yyyy-MM-dd');
}

