import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Upsert a single non_metered_lines registration row.
 * The non-metered equivalent of creating a meter: declares that this
 * (facility, supplier, utility category) combination is being tracked,
 * independently of whether any invoice records exist yet.
 *
 * Safe to call on every write path — conflicts are silently ignored.
 */
export async function upsertNonMeteredLine(
  supabase: SupabaseClient,
  params: { facilityId: string; supplierId: string; categoryId: string }
): Promise<void> {
  const { error } = await supabase
    .from('non_metered_lines')
    .upsert(
      {
        facility_id: params.facilityId,
        supplier_id: params.supplierId,
        utility_category_id: params.categoryId,
      },
      { onConflict: 'facility_id,supplier_id,utility_category_id' }
    );
  if (error) throw new Error(`Failed to register non-metered line: ${error.message}`);
}

/**
 * Upsert multiple non_metered_lines in a single call.
 * Deduplicates by (facilityId, supplierId, categoryId) before inserting.
 */
export async function upsertNonMeteredLines(
  supabase: SupabaseClient,
  lines: Array<{ facilityId: string; supplierId: string; categoryId: string }>
): Promise<void> {
  if (lines.length === 0) return;

  const seen = new Set<string>();
  const rows: Array<{ facility_id: string; supplier_id: string; utility_category_id: string }> = [];
  for (const l of lines) {
    const key = `${l.facilityId}__${l.supplierId}__${l.categoryId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      facility_id: l.facilityId,
      supplier_id: l.supplierId,
      utility_category_id: l.categoryId,
    });
  }

  const { error } = await supabase
    .from('non_metered_lines')
    .upsert(rows, { onConflict: 'facility_id,supplier_id,utility_category_id' });
  if (error) throw new Error(`Failed to register non-metered lines: ${error.message}`);
}
