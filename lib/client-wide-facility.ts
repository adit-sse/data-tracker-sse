import type { SupabaseClient } from '@supabase/supabase-js';

/** Matches upload template / ingestion: Scope 3 rows without a physical site. */
export const CLIENT_WIDE_FACILITY_NAME = '(Client-wide)';

export async function ensureClientWideFacility(
  supabase: SupabaseClient,
  clientId: string
): Promise<{ id: string; name: string }> {
  const { data: existing } = await supabase
    .from('facilities')
    .select('id, name')
    .eq('client_id', clientId)
    .eq('name', CLIENT_WIDE_FACILITY_NAME)
    .maybeSingle();

  if (existing) {
    return { id: existing.id, name: existing.name };
  }

  const { data: created, error } = await supabase
    .from('facilities')
    .insert({ client_id: clientId, name: CLIENT_WIDE_FACILITY_NAME })
    .select('id, name')
    .single();

  if (error) throw new Error(`Failed to create client-wide facility: ${error.message}`);
  return { id: created.id, name: created.name };
}

/** True if ingestion should attach to the synthetic client-wide facility (Scope 3, etc.). */
export function isClientWideFacilityName(name: string | null | undefined): boolean {
  const t = (name ?? '').trim().toLowerCase();
  if (t === '' || t === CLIENT_WIDE_FACILITY_NAME.toLowerCase()) return true;
  // Template / NGERS often use a literal facility label for org-level Scope 3 rows
  if (t === 'scope 3' || t === 'scope3') return true;
  return false;
}
