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
 * Email/API workflow: insert PENDING for months Jul → current month when the slot is empty.
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
): Promise<number> {
  const { facilityId, supplierId, inputTypeId, categoryId, pendingReceivedAt } = params;

  await upsertNonMeteredLine(supabase, { facilityId, supplierId, inputTypeId, categoryId });
  const months = getCurrentFiscalYearMonthsThroughNow();
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

  if (toInsert.length === 0) return 0;

  const { error } = await supabase.from('non_metered_records').insert(toInsert);
  if (error) throw new Error(error.message);
  return toInsert.length;
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

  await upsertNonMeteredLine(supabase, { facilityId, supplierId, inputTypeId, categoryId });
  const months = getFullCurrentFiscalYearMonthPeriods();

  const rows = months.map((month) => ({
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
