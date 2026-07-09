import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentFiscalYearMonthsThroughNow, monthsFromIsoThroughNow } from '@/lib/non-metered-pending-seed';
import { upsertNonMeteredLines, resolveNonMeteredLineIdMap, nonMeteredLineKey } from '@/lib/non-metered-lines';

export type GroupPendingMember = { facility_id: string; input_type_id: string };

/**
 * Seeds PENDING months (current FY through today) for each facility/category pair
 * in a facility group. Matches POST /api/ingestion/pending group-mode behaviour.
 */
export async function seedNonMeteredFacilityGroupPending(
  supabase: SupabaseClient,
  supplierId: string,
  members: GroupPendingMember[],
  pendingReceivedAt?: string
): Promise<{ created: number; skipped: number }> {
  const receivedAt = pendingReceivedAt ?? new Date().toISOString();
  if (members.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const allFacilityIds = members.map((m) => m.facility_id);

  // Fetch every record for the member facilities + supplier once. From this we
  // derive (a) each member's earliest record month → per-member pending range,
  // and (b) the exact/green occupancy sets used to skip filled months.
  const { data: allRecords, error: fetchErr } = await supabase
    .from('non_metered_records')
    .select('facility_id, input_type_id, period_start_date, status')
    .in('facility_id', allFacilityIds)
    .eq('supplier_id', supplierId);

  if (fetchErr) throw new Error(fetchErr.message);

  const GREEN_STATUSES = new Set(['CONFIRMED', 'DEACTIVATED']);
  const existingByCategoryKey = new Set<string>();
  const greenSet = new Set<string>();
  const earliestByMember = new Map<string, string>(); // `${facility_id}__${input_type_id}` -> 'YYYY-MM-DD'

  for (const r of allRecords ?? []) {
    const fac = String(r.facility_id);
    const it = String(r.input_type_id);
    const ps = String(r.period_start_date).slice(0, 10);
    existingByCategoryKey.add(`${fac}__${it}__${ps}`);
    if (GREEN_STATUSES.has(String(r.status))) greenSet.add(`${fac}__${ps}`);
    const key = `${fac}__${it}`;
    const prev = earliestByMember.get(key);
    if (!prev || ps < prev) earliestByMember.set(key, ps);
  }

  const fallbackMonths = getCurrentFiscalYearMonthsThroughNow();

  await upsertNonMeteredLines(
    supabase,
    members.map((m) => ({
      facilityId: m.facility_id,
      supplierId,
      inputTypeId: m.input_type_id,
    }))
  );

  const lineIdByKey = await resolveNonMeteredLineIdMap(
    supabase,
    members.map((m) => ({
      facilityId: m.facility_id,
      supplierId,
      inputTypeId: m.input_type_id,
    }))
  );

  const toInsert = [];
  let totalSlots = 0;
  for (const member of members) {
    const catId = member.input_type_id;
    const lineKey = nonMeteredLineKey(member.facility_id, supplierId, catId);
    const lineId = lineIdByKey.get(lineKey);
    if (!lineId) {
      throw new Error(`Non-metered line not found for member ${member.facility_id} / ${catId}`);
    }
    const earliest = earliestByMember.get(`${member.facility_id}__${catId}`);
    const months = earliest ? monthsFromIsoThroughNow(earliest) : fallbackMonths;
    totalSlots += months.length;
    for (const month of months) {
      const catKey = `${member.facility_id}__${catId}__${month.start}`;
      const greenKey = `${member.facility_id}__${month.start}`;
      if (!existingByCategoryKey.has(catKey) && !greenSet.has(greenKey)) {
        toInsert.push({
          non_metered_line_id: lineId,
          facility_id: member.facility_id,
          supplier_id: supplierId,
          input_type_id: catId,
          period_start_date: month.start,
          period_end_date: month.end,
          status: 'PENDING',
          created_at: receivedAt,
        });
      }
    }
  }

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from('non_metered_records').insert(toInsert);
    if (insertError) throw insertError;
  }

  return {
    created: toInsert.length,
    skipped: totalSlots - toInsert.length,
  };
}
