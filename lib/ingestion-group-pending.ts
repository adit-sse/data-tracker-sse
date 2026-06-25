import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentFiscalYearMonthsThroughNow } from '@/lib/non-metered-pending-seed';
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
  const months = getCurrentFiscalYearMonthsThroughNow();
  const periodStarts = months.map((m) => m.start);

  const [{ data: existingExact }, { data: existingGreen }] = await Promise.all([
    supabase
      .from('non_metered_records')
      .select('facility_id, input_type_id, period_start_date')
      .in('facility_id', allFacilityIds)
      .eq('supplier_id', supplierId)
      .in('period_start_date', periodStarts),
    supabase
      .from('non_metered_records')
      .select('facility_id, period_start_date')
      .in('facility_id', allFacilityIds)
      .eq('supplier_id', supplierId)
      .in('period_start_date', periodStarts)
      .in('status', ['IMPORTED', 'MANUAL', 'CONFIRMED', 'DEACTIVATED']),
  ]);

  const existingByCategoryKey = new Set<string>(
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
  for (const member of members) {
    const catId = member.input_type_id;
    const lineKey = nonMeteredLineKey(member.facility_id, supplierId, catId);
    const lineId = lineIdByKey.get(lineKey);
    if (!lineId) {
      throw new Error(`Non-metered line not found for member ${member.facility_id} / ${catId}`);
    }
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

  const totalSlots = members.length * months.length;
  return {
    created: toInsert.length,
    skipped: totalSlots - toInsert.length,
  };
}
