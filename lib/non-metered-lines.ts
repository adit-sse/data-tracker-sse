import type { SupabaseClient } from '@supabase/supabase-js';

export type NonMeteredLineIdentity = {
  facilityId: string;
  supplierId: string;
  inputTypeId: string;
  categoryId?: string | null;
};

export function nonMeteredLineKey(facilityId: string, supplierId: string, inputTypeId: string): string {
  return `${facilityId}__${supplierId}__${inputTypeId}`;
}

async function fetchNonMeteredLineId(
  supabase: SupabaseClient,
  params: { facilityId: string; supplierId: string; inputTypeId: string }
): Promise<string> {
  const { data, error } = await supabase
    .from('non_metered_lines')
    .select('id')
    .eq('facility_id', params.facilityId)
    .eq('supplier_id', params.supplierId)
    .eq('input_type_id', params.inputTypeId)
    .single();

  if (error || !data) {
    throw new Error(
      `Non-metered line not found for facility ${params.facilityId}, supplier ${params.supplierId}, input type ${params.inputTypeId}`,
    );
  }
  return String(data.id);
}

/**
 * Upsert a single non_metered_lines registration row.
 * Returns the line id and whether a new row was created (vs already existed).
 */
export async function upsertNonMeteredLine(
  supabase: SupabaseClient,
  params: NonMeteredLineIdentity
): Promise<{ id: string; created: boolean }> {
  const { facilityId, supplierId, inputTypeId, categoryId } = params;

  const { data: existing } = await supabase
    .from('non_metered_lines')
    .select('id')
    .eq('facility_id', facilityId)
    .eq('supplier_id', supplierId)
    .eq('input_type_id', inputTypeId)
    .maybeSingle();

  const { error } = await supabase
    .from('non_metered_lines')
    .upsert(
      {
        facility_id: facilityId,
        supplier_id: supplierId,
        input_type_id: inputTypeId,
        category_id: categoryId ?? null,
      },
      { onConflict: 'facility_id,supplier_id,input_type_id', ignoreDuplicates: true }
    );
  if (error) throw new Error(`Failed to register non-metered line: ${error.message}`);

  const id = await fetchNonMeteredLineId(supabase, { facilityId, supplierId, inputTypeId });
  return { id, created: !existing };
}

/** Add a line to a facility group if not already a member. */
export async function ensureLineInFacilityGroup(
  supabase: SupabaseClient,
  lineId: string,
  groupId: string
): Promise<void> {
  const { error } = await supabase
    .from('facility_group_members')
    .upsert(
      { group_id: groupId, non_metered_line_id: lineId },
      { onConflict: 'group_id,non_metered_line_id', ignoreDuplicates: true }
    );
  if (error) {
    throw new Error(`Failed to add line ${lineId} to facility group ${groupId}: ${error.message}`);
  }
}

/**
 * When a new line is created outside group setup, attach it to any existing group
 * for the same supplier that already includes this facility.
 */
export async function ensureLineInMatchingFacilityGroups(
  supabase: SupabaseClient,
  params: { lineId: string; facilityId: string; supplierId: string }
): Promise<void> {
  const { data: groups, error } = await supabase
    .from('facility_groups')
    .select('id, members:facility_group_members(line:non_metered_lines(facility_id))')
    .eq('supplier_id', params.supplierId);

  if (error) throw new Error(error.message);
  if (!groups?.length) return;

  for (const group of groups) {
    const members = (group as { members?: { line?: { facility_id?: string | number } | null }[] | null })
      .members;
    const hasFacility = (members ?? []).some(
      (m) => m.line?.facility_id != null && String(m.line.facility_id) === params.facilityId
    );
    if (hasFacility) {
      await ensureLineInFacilityGroup(supabase, params.lineId, String(group.id));
    }
  }
}

/**
 * Upsert multiple non_metered_lines in a single call.
 * Deduplicates by (facilityId, supplierId, inputTypeId) before inserting.
 */
export async function upsertNonMeteredLines(
  supabase: SupabaseClient,
  lines: NonMeteredLineIdentity[]
): Promise<void> {
  if (lines.length === 0) return;

  const seen = new Set<string>();
  const rows: Array<{ facility_id: string; supplier_id: string; input_type_id: string; category_id: string | null }> = [];
  for (const l of lines) {
    const key = nonMeteredLineKey(l.facilityId, l.supplierId, l.inputTypeId);
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

/** Resolve line ids for a set of identities (lines must already exist). */
export async function resolveNonMeteredLineIdMap(
  supabase: SupabaseClient,
  identities: NonMeteredLineIdentity[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (identities.length === 0) return map;

  const facilityIds = [...new Set(identities.map((i) => i.facilityId))];
  const { data, error } = await supabase
    .from('non_metered_lines')
    .select('id, facility_id, supplier_id, input_type_id')
    .in('facility_id', facilityIds);

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const key = nonMeteredLineKey(
      String(row.facility_id),
      String(row.supplier_id),
      String(row.input_type_id)
    );
    map.set(key, String(row.id));
  }

  return map;
}
