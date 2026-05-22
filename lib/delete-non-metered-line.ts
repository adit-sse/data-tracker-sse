import type { SupabaseClient } from '@supabase/supabase-js';

type LineIdentity = {
  facility_id: string;
  supplier_id: string;
  input_type_id: string;
};

/** Delete all invoice records for a non-metered line (handles inferred_from_id ordering). */
async function deleteRecordsForLine(
  supabase: SupabaseClient,
  line: LineIdentity
): Promise<void> {
  const { data: records, error: fetchErr } = await supabase
    .from('non_metered_records')
    .select('id')
    .eq('facility_id', line.facility_id)
    .eq('supplier_id', line.supplier_id)
    .eq('input_type_id', line.input_type_id);

  if (fetchErr) throw fetchErr;

  const ids = (records ?? []).map((r) => String(r.id));
  if (ids.length === 0) return;

  const { error: childErr } = await supabase
    .from('non_metered_records')
    .delete()
    .in('inferred_from_id', ids);
  if (childErr) throw childErr;

  const { error: deleteErr } = await supabase
    .from('non_metered_records')
    .delete()
    .eq('facility_id', line.facility_id)
    .eq('supplier_id', line.supplier_id)
    .eq('input_type_id', line.input_type_id);
  if (deleteErr) throw deleteErr;
}

/**
 * Delete a non_metered_lines row, its coverage records, and any group memberships.
 */
export async function deleteNonMeteredLine(
  supabase: SupabaseClient,
  lineId: string
): Promise<{ groupNames: string[] }> {
  const { data: line, error: lineErr } = await supabase
    .from('non_metered_lines')
    .select('id, facility_id, supplier_id, input_type_id')
    .eq('id', lineId)
    .single();

  if (lineErr || !line) {
    throw new Error('Line not found');
  }

  const identity: LineIdentity = {
    facility_id: String(line.facility_id),
    supplier_id: String(line.supplier_id),
    input_type_id: String(line.input_type_id),
  };

  const { data: memberships, error: memberFetchErr } = await supabase
    .from('facility_group_members')
    .select('group_id, group:facility_groups(name)')
    .eq('non_metered_line_id', lineId);
  if (memberFetchErr) throw memberFetchErr;

  const groupNames = [
    ...new Set(
      (memberships ?? [])
        .map((m) => {
          const g = m.group as { name?: string } | { name?: string }[] | null;
          if (Array.isArray(g)) return g[0]?.name;
          return g?.name;
        })
        .filter((n): n is string => !!n)
    ),
  ];

  await deleteRecordsForLine(supabase, identity);

  const { error: memberDeleteErr } = await supabase
    .from('facility_group_members')
    .delete()
    .eq('non_metered_line_id', lineId);
  if (memberDeleteErr) throw memberDeleteErr;

  const { error: lineDeleteErr } = await supabase
    .from('non_metered_lines')
    .delete()
    .eq('id', lineId);
  if (lineDeleteErr) throw lineDeleteErr;

  return { groupNames };
}
