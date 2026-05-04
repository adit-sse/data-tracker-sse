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
  params: { facilityId: string; supplierId: string; inputTypeId: string; categoryId?: string | null }
): Promise<void> {
  const { error } = await supabase
    .from('non_metered_lines')
    .upsert(
      {
        facility_id: params.facilityId,
        supplier_id: params.supplierId,
        input_type_id: params.inputTypeId,
        category_id: params.categoryId ?? null,
      },
      { onConflict: 'facility_id,supplier_id,input_type_id', ignoreDuplicates: true }
    );
  if (error) throw new Error(`Failed to register non-metered line: ${error.message}`);
}

/**
 * Upsert multiple non_metered_lines in a single call.
 * Deduplicates by (facilityId, supplierId, inputTypeId) before inserting.
 */
export async function upsertNonMeteredLines(
  supabase: SupabaseClient,
  lines: Array<{ facilityId: string; supplierId: string; inputTypeId: string; categoryId?: string | null }>
): Promise<void> {
  if (lines.length === 0) return;

  const seen = new Set<string>();
  const rows: Array<{ facility_id: string; supplier_id: string; input_type_id: string; category_id: string | null }> = [];
  for (const l of lines) {
    const key = `${l.facilityId}__${l.supplierId}__${l.inputTypeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      facility_id: l.facilityId,
      supplier_id: l.supplierId,
      input_type_id: l.inputTypeId,
      category_id: l.categoryId ?? null,
    });
  }

  const { error } = await supabase
    .from('non_metered_lines')
    .upsert(rows, { onConflict: 'facility_id,supplier_id,input_type_id', ignoreDuplicates: true });
  if (error) throw new Error(`Failed to register non-metered lines: ${error.message}`);
}
