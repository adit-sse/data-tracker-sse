import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureClientWideFacility, isClientWideFacilityName } from '@/lib/client-wide-facility';
import { findOrCreateUtilityCategoryForIngestion } from '@/lib/ingestion-utility-category';

/** Resolve client, supplier, utility category, and facility (under client) for standalone line ingestion. */
export async function resolveIngestionLine(
  supabase: SupabaseClient,
  clientName: string,
  facilityName: string,
  supplierName: string,
  utilityName: string
): Promise<
  | {
      ok: true;
      clientId: string;
      facilityId: string;
      facilityName: string;
      supplierId: string;
      categoryId: string;
    }
  | { ok: false; error: string; status: number }
> {
  const [{ data: client }, { data: supplier }] = await Promise.all([
    supabase.from('clients').select('id').ilike('name', clientName).single(),
    supabase.from('suppliers').select('id').ilike('name', supplierName).single(),
  ]);

  if (!client) return { ok: false, error: `Client "${clientName}" not found`, status: 404 };
  if (!supplier) return { ok: false, error: `Supplier "${supplierName}" not found`, status: 404 };

  let category: { id: string; scope: number };
  try {
    category = await findOrCreateUtilityCategoryForIngestion(supabase, utilityName);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: msg, status: 400 };
  }

  const scope = category.scope;

  if (scope === 3 && isClientWideFacilityName(facilityName)) {
    const facility = await ensureClientWideFacility(supabase, client.id);
    return {
      ok: true,
      clientId: client.id,
      facilityId: facility.id,
      facilityName: facility.name,
      supplierId: supplier.id,
      categoryId: category.id,
    };
  }

  const facLookup = facilityName?.trim();
  if (!facLookup) {
    return {
      ok: false,
      error: `facility_name is required for "${utilityName}" (Scope ${scope}; only Scope 3 can omit facility or use "(Client-wide)")`,
      status: 400,
    };
  }

  const { data: facility, error: facErr } = await supabase
    .from('facilities')
    .select('id, name')
    .eq('client_id', client.id)
    .ilike('name', facLookup)
    .single();

  if (facErr || !facility) {
    return {
      ok: false,
      error: `Facility "${facilityName}" not found for client "${clientName}"`,
      status: 404,
    };
  }

  return {
    ok: true,
    clientId: client.id,
    facilityId: facility.id,
    facilityName: facility.name,
    supplierId: supplier.id,
    categoryId: category.id,
  };
}
