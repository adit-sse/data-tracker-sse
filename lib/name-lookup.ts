/**
 * Fuzzy name resolution via Postgres RPC functions (get_client_by_name, etc.).
 *
 * RPC = Remote Procedure Call — the app invokes a stored function in the database
 * through Supabase's `.rpc()` API. Matching logic (ILIKE, then pg_trgm similarity)
 * lives entirely in Postgres; these helpers only call the function and read the first row.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { idKey, type RowId } from '@/lib/row-id';
import { CANONICAL_CLIENTS } from '@/lib/canonical/data';
import { resolveCanonical } from '@/lib/canonical/match';

/**
 * `id` is always the normalised string form (see lib/row-id), while the same
 * column read directly through PostgREST yields a number for integer keys.
 * Compare these ids with `sameId` and key them with `idKey` — a raw `===`
 * against a value that did not come through here is always false.
 */
export type NameMatch = { id: string; name: string };

type LookupResult = { data: NameMatch | null; error: string | null };

type RpcNameRow = { id: RowId; name: string };

async function firstRpcRow(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>
): Promise<LookupResult> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { data: null, error: error.message };
  const row = ((data ?? []) as RpcNameRow[])[0];
  return {
    data: row ? { id: idKey(row.id), name: row.name } : null,
    error: null,
  };
}

/**
 * Resolve a client by name, retrying under its standardised name.
 *
 * The name as sent is tried first: the tracker's own client names are the
 * authority, and rewriting up front could push a name that already matched
 * further away (the tracker holds "North Metro TAFE", the workbook
 * "North Metropolitan Tafe"). Standardisation is a fallback for inbound names
 * the tracker does not recognise, not a rewrite of ones it does.
 */
export async function lookupClientByName(
  supabase: SupabaseClient,
  name: string
): Promise<LookupResult> {
  const direct = await firstRpcRow(supabase, 'get_client_by_name', { input_name: name });
  if (direct.error || direct.data) return direct;

  const standardised = resolveCanonical(name, CANONICAL_CLIENTS);
  if (!standardised || standardised.canonical.toLowerCase() === name.trim().toLowerCase()) {
    return direct;
  }

  return firstRpcRow(supabase, 'get_client_by_name', { input_name: standardised.canonical });
}

export function lookupSupplierByName(
  supabase: SupabaseClient,
  name: string
): Promise<LookupResult> {
  return firstRpcRow(supabase, 'get_supplier_by_name', { input_name: name });
}

type AliasRow = {
  facility:
    | { id: RowId; name: string; client_id: RowId }
    | { id: RowId; name: string; client_id: RowId }[]
    | null;
};

/**
 * Resolve a facility via facility_aliases — alternative names a client's source
 * data uses for a site (see migration 023).
 *
 * Returns an error rather than a match when two of the client's facilities share
 * an alias: picking one silently would misfile consumption with no symptom.
 */
async function lookupFacilityByAlias(
  supabase: SupabaseClient,
  name: string,
  clientId: string | number
): Promise<LookupResult> {
  const alias = typeof name === 'string' ? name.trim() : '';
  if (!alias) return { data: null, error: null };

  const { data, error } = await supabase
    .from('facility_aliases')
    .select('facility:facilities!inner(id, name, client_id)')
    .ilike('alias', alias)
    .eq('facility.client_id', Number(clientId))
    .limit(3);

  // A missing table (alias migration not applied yet) must not break resolution.
  if (error) return { data: null, error: null };

  const matches = ((data ?? []) as AliasRow[])
    .map((r) => (Array.isArray(r.facility) ? r.facility[0] : r.facility))
    .filter((f): f is { id: RowId; name: string; client_id: RowId } => Boolean(f));

  if (matches.length === 0) return { data: null, error: null };

  const distinctIds = new Set(matches.map((f) => idKey(f.id)));
  if (distinctIds.size > 1) {
    return {
      data: null,
      error:
        `Alias "${alias}" maps to more than one facility for this client ` +
        `(${matches.map((f) => `"${f.name}"`).join(', ')}). ` +
        'Remove the duplicate in facility_aliases.',
    };
  }

  return { data: { id: idKey(matches[0].id), name: matches[0].name }, error: null };
}

export async function lookupFacilityByName(
  supabase: SupabaseClient,
  name: string,
  clientId: string | number
): Promise<LookupResult> {
  // Aliases are checked first deliberately. They are an explicit, hand-curated
  // mapping, whereas get_facility_by_name falls back to trigram similarity — and
  // an address is exactly the kind of input that can fuzzily match the wrong
  // facility name. Curated beats inferred.
  const byAlias = await lookupFacilityByAlias(supabase, name, clientId);
  if (byAlias.error || byAlias.data) return byAlias;

  return firstRpcRow(supabase, 'get_facility_by_name', {
    input_name: name,
    input_client_id: Number(clientId),
  });
}

export async function lookupClientAndSupplier(
  supabase: SupabaseClient,
  clientName: string,
  supplierName: string
): Promise<
  | { ok: true; client: NameMatch; supplier: NameMatch }
  | { ok: false; error: string; status: number }
> {
  const [clientLookup, supplierLookup] = await Promise.all([
    lookupClientByName(supabase, clientName),
    lookupSupplierByName(supabase, supplierName),
  ]);

  if (clientLookup.error) {
    return { ok: false, error: clientLookup.error, status: 500 };
  }
  if (supplierLookup.error) {
    return { ok: false, error: supplierLookup.error, status: 500 };
  }
  if (!clientLookup.data) {
    return { ok: false, error: `Client "${clientName}" not found`, status: 404 };
  }
  if (!supplierLookup.data) {
    return { ok: false, error: `Supplier "${supplierName}" not found`, status: 404 };
  }

  return { ok: true, client: clientLookup.data, supplier: supplierLookup.data };
}
