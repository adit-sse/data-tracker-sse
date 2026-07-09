import type { SupabaseClient } from '@supabase/supabase-js';
import { eachMonthStartIsoOverlapping } from '@/lib/metered-gap-pending';

export type SlotStatus = 'PENDING' | 'ERROR' | 'DEACTIVATED';

export interface MeterMonthSlotRow {
  id: string;
  meter_id: string;
  month_start: string; // YYYY-MM-01
  status: SlotStatus;
  created_at?: string;
}

/**
 * Upsert month slots for a meter covering every calendar month that overlaps
 * [periodStart, periodEnd]. Only inserts if no slot exists yet — existing slots
 * are never downgraded (e.g. an ERROR slot is not reset to PENDING).
 */
export async function upsertPendingMonthSlots(
  supabase: SupabaseClient,
  meterId: string,
  periodStart: string,
  periodEnd: string
): Promise<void> {
  const monthStarts = eachMonthStartIsoOverlapping(periodStart, periodEnd);
  if (monthStarts.length === 0) return;

  const rows = monthStarts.map((ms) => ({
    meter_id: meterId,
    month_start: ms,
    status: 'PENDING' as SlotStatus,
  }));

  const { error } = await supabase
    .from('meter_month_slots')
    .upsert(rows, { onConflict: 'meter_id,month_start', ignoreDuplicates: true });

  if (error) throw new Error(error.message);
}

/**
 * Upsert a DEACTIVATED slot for a specific month.
 * Only inserts; an existing ERROR or PENDING slot is left as-is.
 */
export async function upsertDeactivatedMonthSlot(
  supabase: SupabaseClient,
  meterId: string,
  periodStart: string,
  periodEnd: string
): Promise<void> {
  const monthStarts = eachMonthStartIsoOverlapping(periodStart, periodEnd);
  if (monthStarts.length === 0) return;

  const rows = monthStarts.map((ms) => ({
    meter_id: meterId,
    month_start: ms,
    status: 'DEACTIVATED' as SlotStatus,
  }));

  const { error } = await supabase
    .from('meter_month_slots')
    .upsert(rows, { onConflict: 'meter_id,month_start', ignoreDuplicates: true });

  if (error) throw new Error(error.message);
}

/**
 * Set a slot to ERROR for the calendar month containing periodStart.
 * Upserts the slot (creates if missing, updates status to ERROR if present).
 */
export async function upsertErrorMonthSlot(
  supabase: SupabaseClient,
  meterId: string,
  monthStart: string
): Promise<void> {
  const { error } = await supabase
    .from('meter_month_slots')
    .upsert(
      [{ meter_id: meterId, month_start: monthStart, status: 'ERROR' }],
      { onConflict: 'meter_id,month_start' }
    );

  if (error) throw new Error(error.message);
}

/**
 * Fetch all slots for a set of meters, optionally scoped to a date window.
 * Returns rows indexed by meter_id.
 */
export async function fetchSlotsByMeter(
  supabase: SupabaseClient,
  meterIds: string[],
  fromMonthStart?: string,
  toMonthStart?: string
): Promise<Map<string, MeterMonthSlotRow[]>> {
  if (meterIds.length === 0) return new Map();

  const CHUNK = 200;
  const allSlots: MeterMonthSlotRow[] = [];

  for (let i = 0; i < meterIds.length; i += CHUNK) {
    const chunk = meterIds.slice(i, i + CHUNK);
    let q = supabase
      .from('meter_month_slots')
      .select('id, meter_id, month_start, status, created_at')
      .in('meter_id', chunk);

    if (fromMonthStart) q = q.gte('month_start', fromMonthStart);
    if (toMonthStart) q = q.lte('month_start', toMonthStart);

    const { data, error } = await q.limit(10000);
    if (error) {
      console.error('[meter-month-slots] fetchSlotsByMeter error:', error.message);
      return new Map(); // degrade gracefully — coverage still works without slots
    }
    allSlots.push(...(data ?? []));
  }

  const byMeter = new Map<string, MeterMonthSlotRow[]>();
  for (const slot of allSlots) {
    const list = byMeter.get(slot.meter_id) ?? [];
    list.push(slot);
    byMeter.set(slot.meter_id, list);
  }
  return byMeter;
}
