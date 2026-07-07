import type { SupabaseClient } from '@supabase/supabase-js';
import { generateFiscalYearMonths } from '@/lib/coverage';
import { upsertNonMeteredLine } from '@/lib/non-metered-lines';

/** Fiscal months from July through the current calendar month (ingestion / email workflow). */
export function getCurrentFiscalYearMonthsThroughNow(): Array<{ start: string; end: string }> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  const fyStartYear = currentMonth >= 6 ? currentYear : currentYear - 1;
  const cursor = new Date(fyStartYear, 6, 1);
  const endMonth = new Date(currentYear, currentMonth, 1);

  const months: Array<{ start: string; end: string }> = [];
  while (cursor <= endMonth) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    months.push({
      start: `${y}-${String(m + 1).padStart(2, '0')}-01`,
      end: `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

/**
 * Month periods from the given month (any ISO date string, e.g. "2025-07-01"
 * or "2025-07-14") through the current calendar month. Returns [] if the start
 * is after the current month or unparseable. Used to seed PENDING from an
 * entity's earliest existing record through now.
 */
export function monthsFromIsoThroughNow(startIso: string): Array<{ start: string; end: string }> {
  const [yStr, mStr] = String(startIso).slice(0, 7).split('-');
  const startYear = Number(yStr);
  const startMonthZero = Number(mStr) - 1;
  if (Number.isNaN(startYear) || Number.isNaN(startMonthZero)) return [];

  const now = new Date();
  const endMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const cursor = new Date(startYear, startMonthZero, 1);
  if (cursor > endMonth) return [];

  const months: Array<{ start: string; end: string }> = [];
  while (cursor <= endMonth) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    months.push({
      start: `${y}-${String(m + 1).padStart(2, '0')}-01`,
      end: `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

/** Earliest non_metered_records.period_start_date (YYYY-MM-DD) for a line, or null if none. */
export async function earliestNonMeteredMonthStart(
  supabase: SupabaseClient,
  facilityId: string,
  supplierId: string,
  inputTypeId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('non_metered_records')
    .select('period_start_date')
    .eq('facility_id', facilityId)
    .eq('supplier_id', supplierId)
    .eq('input_type_id', inputTypeId)
    .order('period_start_date', { ascending: true })
    .limit(1);
  const first = (data ?? [])[0]?.period_start_date;
  return typeof first === 'string' ? first.slice(0, 10) : null;
}

function currentFiscalYearEnd(): number {
  const now = new Date();
  return now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
}

/** All 12 months of the current fiscal year (Jul–Jun) as period bounds. */
export function getFullCurrentFiscalYearMonthPeriods(): Array<{ start: string; end: string }> {
  const fyEnd = currentFiscalYearEnd();
  return generateFiscalYearMonths(fyEnd).map((d) => {
    const y = d.getFullYear();
    const m = d.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    return {
      start: `${y}-${String(m + 1).padStart(2, '0')}-01`,
      end: `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    };
  });
}

const GREEN_STATUSES = ['IMPORTED', 'MANUAL', 'CONFIRMED', 'DEACTIVATED'] as const;

/**
 * Email/API workflow: insert PENDING for every "no data" month from the line's
 * earliest existing record through the current month. Falls back to the current
 * fiscal year through now when the line has no records yet. Returns created /
 * skipped counts.
 */
export async function seedIngestionPendingNonMeteredLineMonths(
  supabase: SupabaseClient,
  params: {
    facilityId: string;
    supplierId: string;
    inputTypeId: string;
    categoryId?: string | null;
    /** When POST /api/ingestion/pending ran — stored as created_at so UI shows invoice-received time. */
    pendingReceivedAt?: string;
  }
): Promise<{ created: number; skipped: number }> {
  const { facilityId, supplierId, inputTypeId, categoryId, pendingReceivedAt } = params;

  const { id: lineId } = await upsertNonMeteredLine(supabase, { facilityId, supplierId, inputTypeId, categoryId });

  const earliest = await earliestNonMeteredMonthStart(supabase, facilityId, supplierId, inputTypeId);
  const months = earliest ? monthsFromIsoThroughNow(earliest) : getCurrentFiscalYearMonthsThroughNow();
  const periodStarts = months.map((m) => m.start);

  const [{ data: existingExact }, { data: existingGreen }] = await Promise.all([
    supabase
      .from('non_metered_records')
      .select('facility_id, input_type_id, period_start_date')
      .eq('facility_id', facilityId)
      .eq('supplier_id', supplierId)
      .in('period_start_date', periodStarts),
    supabase
      .from('non_metered_records')
      .select('facility_id, period_start_date')
      .eq('facility_id', facilityId)
      .eq('supplier_id', supplierId)
      .in('period_start_date', periodStarts)
      .in('status', [...GREEN_STATUSES]),
  ]);

  const existingByInputTypeKey = new Set<string>(
    (existingExact ?? []).map(
      (r: { facility_id: string; input_type_id: string; period_start_date: string }) =>
        `${r.facility_id}__${r.input_type_id}__${r.period_start_date}`
    )
  );
  const greenSet = new Set<string>(
    (existingGreen ?? []).map(
      (r: { facility_id: string; period_start_date: string }) =>
        `${r.facility_id}__${r.period_start_date}`
    )
  );

  const toInsert: Array<{
    non_metered_line_id: string;
    facility_id: string;
    supplier_id: string;
    input_type_id: string;
    period_start_date: string;
    period_end_date: string;
    status: string;
    inferred_from_id: null;
    created_at: string;
  }> = [];

  for (const month of months) {
    const typeKey = `${facilityId}__${inputTypeId}__${month.start}`;
    const greenKey = `${facilityId}__${month.start}`;
    if (!existingByInputTypeKey.has(typeKey) && !greenSet.has(greenKey)) {
      toInsert.push({
        non_metered_line_id: lineId,
        facility_id: facilityId,
        supplier_id: supplierId,
        input_type_id: inputTypeId,
        period_start_date: month.start,
        period_end_date: month.end,
        status: 'PENDING',
        inferred_from_id: null,
        created_at: pendingReceivedAt ?? new Date().toISOString(),
      });
    }
  }

  if (toInsert.length === 0) return { created: 0, skipped: months.length };

  const { error } = await supabase.from('non_metered_records').insert(toInsert);
  if (error) throw new Error(error.message);
  return { created: toInsert.length, skipped: months.length - toInsert.length };
}

/**
 * Meter-setup CSV: Scope 3 lines are master-data coverage, not the email workflow.
 * Upserts IMPORTED placeholders for the full fiscal year so the grid shows “received”
 * (and can be edited), not PENDING.
 */
export async function upsertTemplateScope3CoverageMonths(
  supabase: SupabaseClient,
  params: { facilityId: string; supplierId: string; inputTypeId: string; categoryId?: string | null }
): Promise<number> {
  const { facilityId, supplierId, inputTypeId, categoryId } = params;

  const { id: lineId } = await upsertNonMeteredLine(supabase, { facilityId, supplierId, inputTypeId, categoryId });
  const months = getFullCurrentFiscalYearMonthPeriods();

  const rows = months.map((month) => ({
    non_metered_line_id: lineId,
    facility_id: facilityId,
    supplier_id: supplierId,
    input_type_id: inputTypeId,
    period_start_date: month.start,
    period_end_date: month.end,
    invoice_number: null as string | null,
    invoice_date: null as string | null,
    consumption: null as number | null,
    unit: null as string | null,
    amount: null as number | null,
    framework: null as string | null,
    version: null as string | null,
    customer: null as string | null,
    status: 'IMPORTED',
    inferred_from_id: null as null,
  }));

  const { error } = await supabase.from('non_metered_records').upsert(rows, {
    onConflict: 'facility_id,supplier_id,input_type_id,period_start_date,period_end_date',
  });

  if (error) throw new Error(error.message);
  return rows.length;
}
