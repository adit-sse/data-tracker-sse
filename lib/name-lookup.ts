/**
 * Fuzzy name resolution via Postgres RPC functions (get_client_by_name, etc.).
 *
 * RPC = Remote Procedure Call — the app invokes a stored function in the database
 * through Supabase's `.rpc()` API. Matching logic (ILIKE, then pg_trgm similarity)
 * lives entirely in Postgres; these helpers only call the function and read the first row.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { idKey, type RowId } from '@/lib/row-id';

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

export function lookupClientByName(
  supabase: SupabaseClient,
  name: string
): Promise<LookupResult> {
  return firstRpcRow(supabase, 'get_client_by_name', { input_name: name });
}

export function lookupSupplierByName(
  supabase: SupabaseClient,
  name: string
): Promise<LookupResult> {
  return firstRpcRow(supabase, 'get_supplier_by_name', { input_name: name });
}

export function lookupFacilityByName(
  supabase: SupabaseClient,
  name: string,
  clientId: string | number
): Promise<LookupResult> {
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
