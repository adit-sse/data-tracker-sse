import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, addMonths, endOfMonth, format, parseISO, startOfMonth } from 'date-fns';

/** Real consumption / invoice data — day does not need a gap PENDING row. */
const DATA_STATUSES = new Set(['CONFIRMED', 'IMPORTED', 'MANUAL_ENTRY', 'MANUAL']);

/** No further invoice expected for the day — do not insert gap PENDING. */
const SUPPRESS_GAP_STATUSES = new Set(['DEACTIVATED', 'INFERRED_EMPTY']);

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

function eachDayIsoInclusive(startIso: string, endIso: string): string[] {
  const keys: string[] = [];
  let cur = parseISO(startIso);
  const end = parseISO(endIso);
  while (cur <= end) {
    keys.push(format(cur, 'yyyy-MM-dd'));
    cur = addDays(cur, 1);
  }
  return keys;
}

function periodOverlapsDay(
  rowStart: string,
  rowEnd: string,
  dayIso: string
): boolean {
  return rowStart <= dayIso && rowEnd >= dayIso;
}

/**
 * Days in [monthStart, monthEnd] that still need a gap PENDING placeholder
 * (no real data, not suppressed by DEACTIVATED / INFERRED_EMPTY).
 */
function computeGapDayKeys(
  monthStart: string,
  monthEnd: string,
  rows: Array<{ period_start_date: string; period_end_date: string; status: string | null }>
): string[] {
  const monthDays = eachDayIsoInclusive(monthStart, monthEnd);
  const gapDays: string[] = [];

  for (const day of monthDays) {
    let hasData = false;
    let suppressed = false;

    for (const row of rows) {
      const rs = String(row.period_start_date).slice(0, 10);
      const re = String(row.period_end_date).slice(0, 10);
      if (!periodOverlapsDay(rs, re, day)) continue;

      const s = (row.status || '').trim().toUpperCase();
      if (s === 'PENDING' || s === 'ERROR') continue;
      if (DATA_STATUSES.has(s)) {
        hasData = true;
        break;
      }
      if (SUPPRESS_GAP_STATUSES.has(s)) suppressed = true;
    }

    if (!hasData && !suppressed) gapDays.push(day);
  }

  return gapDays;
}

/** Merge sorted ISO dates into contiguous [start, end] ranges inclusive. */
function mergeContiguousDayRanges(sortedDayKeys: string[]): { start: string; end: string }[] {
  if (sortedDayKeys.length === 0) return [];
  const sorted = [...sortedDayKeys].sort();
  const ranges: { start: string; end: string }[] = [];
  let runStart = sorted[0]!;
  let runEnd = sorted[0]!;

  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i]!;
    const prevEnd = runEnd;
    const expectedNext = format(addDays(parseISO(prevEnd), 1), 'yyyy-MM-dd');
    if (d === expectedNext) {
      runEnd = d;
    } else {
      ranges.push({ start: runStart, end: runEnd });
      runStart = d;
      runEnd = d;
    }
  }
  ranges.push({ start: runStart, end: runEnd });
  return ranges;
}

/**
 * Reconcile PENDING rows for specific calendar months: remove PENDING overlapping any of the
 * given months, then insert one PENDING row per contiguous uncovered day segment per month.
 *
 * Bulk implementation: issues 3 queries total regardless of how many months are passed
 * (was: up to 4 queries × N months in the per-month loop).
 *
 *   Query 1 – select all invoices for this meter covering [minMonthStart, maxMonthEnd]
 *   Query 2 – delete all PENDING rows identified from Query 1
 *   Query 3 – insert all new gap-PENDING rows across all months in one call
 */
export async function syncMeteredGapPendingForMonths(
  supabase: SupabaseClient,
  meterId: string,
  monthStarts: Iterable<string>,
  pendingReceivedAt: string
): Promise<{ deleted: number; inserted: number }> {
  const uniqueMonthStarts = Array.from(new Set(monthStarts)).sort();
  if (uniqueMonthStarts.length === 0) return { deleted: 0, inserted: 0 };

  const overallRangeStart = uniqueMonthStarts[0];
  const overallRangeEnd = monthEndIsoFromMonthStart(uniqueMonthStarts[uniqueMonthStarts.length - 1]);

  // Query 1: load every invoice for this meter that touches any of the affected months.
  const { data: allRows, error: fetchErr } = await supabase
    .from('actual_invoices')
    .select('id, period_start_date, period_end_date, status')
    .eq('meter_id', meterId)
    .lte('period_start_date', overallRangeEnd)
    .gte('period_end_date', overallRangeStart)
    .limit(10000);

  if (fetchErr) throw new Error(fetchErr.message);

  const rows = allRows ?? [];

  // Collect all PENDING IDs to delete across all months in a single pass.
  const pendingIds = rows
    .filter((r) => (r.status as string) === 'PENDING')
    .map((r) => r.id as string);

  // Query 2: batch delete all PENDING rows (was: one delete per month).
  let deleted = 0;
  if (pendingIds.length > 0) {
    const { error: delErr } = await supabase
      .from('actual_invoices')
      .delete()
      .in('id', pendingIds);
    if (delErr) throw new Error(delErr.message);
    deleted = pendingIds.length;
  }

  // Build gap PENDING rows per month using the already-loaded non-PENDING rows.
  const nonPendingRows = rows.filter((r) => (r.status as string) !== 'PENDING');

  const allToInsert: Array<{
    meter_id: string;
    period_start_date: string;
    period_end_date: string;
    status: string;
    created_at: string;
  }> = [];

  for (const monthStart of uniqueMonthStarts) {
    const monthEnd = monthEndIsoFromMonthStart(monthStart);
    const monthRows = nonPendingRows.filter(
      (r) => (r.period_start_date as string) <= monthEnd && (r.period_end_date as string) >= monthStart
    );
    const gapDays = computeGapDayKeys(monthStart, monthEnd, monthRows);
    const ranges = mergeContiguousDayRanges(gapDays);
    for (const r of ranges) {
      allToInsert.push({
        meter_id: meterId,
        period_start_date: r.start,
        period_end_date: r.end,
        status: 'PENDING',
        created_at: pendingReceivedAt,
      });
    }
  }

  // Query 3: single insert for all gap rows across all months.
  let inserted = 0;
  if (allToInsert.length > 0) {
    const { error: insErr } = await supabase.from('actual_invoices').insert(allToInsert);
    if (insErr) throw new Error(insErr.message);
    inserted = allToInsert.length;
  }

  return { deleted, inserted };
}
