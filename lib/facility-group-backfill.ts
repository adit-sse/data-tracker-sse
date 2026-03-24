import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Retroactive inference backfill for a facility group.
 *
 * When a group is created or its members change, we scan all existing
 * non_metered_records for that supplier across the member facilities.
 * For each (utility_category_id, period_start_date, period_end_date) slice
 * that has at least one real record, we insert INFERRED_EMPTY for any
 * member facility that has no record for that slice.
 *
 * ignoreDuplicates: true ensures we never overwrite IMPORTED or MANUAL records.
 */
export async function runGroupBackfill(
  supabase: SupabaseClient,
  supplierId: string,
  memberFacilityIds: string[]
): Promise<void> {
  if (memberFacilityIds.length < 2) return;

  // Fetch all existing records for these facilities + supplier
  const { data: existingRecords, error } = await supabase
    .from('non_metered_records')
    .select('id, facility_id, utility_category_id, period_start_date, period_end_date, status')
    .in('facility_id', memberFacilityIds)
    .eq('supplier_id', supplierId);

  if (error || !existingRecords?.length) return;

  // Group by (utility_category_id, period_start_date, period_end_date)
  const slices = new Map<
    string,
    {
      utility_category_id: string;
      period_start_date: string;
      period_end_date: string;
      presentFacilityIds: Set<string>;
      referenceId: string;
    }
  >();

  for (const rec of existingRecords) {
    const key = `${rec.utility_category_id}__${rec.period_start_date}__${rec.period_end_date}`;
    if (!slices.has(key)) {
      slices.set(key, {
        utility_category_id: String(rec.utility_category_id),
        period_start_date: rec.period_start_date,
        period_end_date: rec.period_end_date,
        presentFacilityIds: new Set(),
        referenceId: String(rec.id),
      });
    }
    const slice = slices.get(key)!;
    slice.presentFacilityIds.add(String(rec.facility_id));
    // Prefer a real record as the reference
    if (rec.status === 'IMPORTED' || rec.status === 'MANUAL') {
      slice.referenceId = String(rec.id);
    }
  }

  const memberIdSet = new Set(memberFacilityIds.map(String));

  for (const slice of Array.from(slices.values())) {
    const absentIds = Array.from(memberIdSet).filter(
      (fid) => !slice.presentFacilityIds.has(fid)
    );

    if (absentIds.length === 0) continue;

    for (const facilityId of absentIds) {
      await supabase
        .from('non_metered_records')
        .upsert(
          {
            facility_id: facilityId,
            supplier_id: supplierId,
            utility_category_id: slice.utility_category_id,
            period_start_date: slice.period_start_date,
            period_end_date: slice.period_end_date,
            status: 'INFERRED_EMPTY',
            inferred_from_id: slice.referenceId,
          },
          {
            onConflict:
              'facility_id,supplier_id,utility_category_id,period_start_date,period_end_date',
            ignoreDuplicates: true, // never overwrite IMPORTED or MANUAL
          }
        );
    }
  }
}
