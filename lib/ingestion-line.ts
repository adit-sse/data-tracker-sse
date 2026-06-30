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
  const [{ data: client }, { data: supplierRaw }] = await Promise.all([
    supabase.from('clients').select('id').ilike('name', clientName).single(),
    supabase.rpc('get_supplier_by_name', { input_name: supplierName }).single(),
  ]);
  const supplier = supplierRaw as { id: string; name: string } | null;

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
  const facTrimmed = typeof facilityName === 'string' ? facilityName.trim() : '';

  if (facTrimmed) {
    if (scope === 3 && isClientWideFacilityName(facTrimmed)) {
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

    const { data: facility, error: facErr } = await supabase
      .from('facilities')
      .select('id, name')
      .eq('client_id', client.id)
      .ilike('name', facTrimmed)
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

  // Omitted facility: standalone line = exactly one non_metered_lines row for client + supplier + utility
  const { data: clientFacilities, error: cfErr } = await supabase
    .from('facilities')
    .select('id')
    .eq('client_id', client.id);

  if (cfErr) {
    return { ok: false, error: cfErr.message, status: 500 };
  }

  const facilityIds = (clientFacilities ?? []).map((f: { id: string }) => f.id);
  if (facilityIds.length === 0) {
    return { ok: false, error: `No facilities found for client "${clientName}"`, status: 404 };
  }

  const { data: lineRows, error: linesErr } = await supabase
    .from('non_metered_lines')
    .select('facility_id, facility:facilities(id, name)')
    .eq('supplier_id', supplier.id)
    .eq('input_type_id', category.id)
    .in('facility_id', facilityIds);

  if (linesErr) {
    return { ok: false, error: linesErr.message, status: 500 };
  }

  type Target = { facilityId: string; facilityName: string };
  const byId = new Map<string, Target>();
  for (const row of lineRows ?? []) {
    const raw = row.facility as unknown;
    const f = Array.isArray(raw) ? raw[0] : raw;
    const facility = f as { id: string; name: string } | null | undefined;
    if (facility?.id) {
      byId.set(facility.id, { facilityId: facility.id, facilityName: facility.name });
    }
  }
  const distinct = Array.from(byId.values());

  if (distinct.length > 1) {
    return {
      ok: false,
      error: `Multiple facilities have supplier "${supplierName}" and utility "${utilityName}" for this client — use a facility group and group pending, or pass facility_name.`,
      status: 409,
    };
  }

  if (distinct.length === 1) {
    const t = distinct[0];
    return {
      ok: true,
      clientId: client.id,
      facilityId: t.facilityId,
      facilityName: t.facilityName,
      supplierId: supplier.id,
      categoryId: category.id,
    };
  }

  if (scope === 3 && isClientWideFacilityName(facTrimmed)) {
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

  return {
    ok: false,
    error: `No non_metered_lines row for client "${clientName}", supplier "${supplierName}", utility "${utilityName}". Add coverage in the tracker or pass facility_name.`,
    status: 404,
  };
}

/**
 * Group-style confirm payloads include NGERS Category + Input Type + Facility.
 * When there is no matching `facility_groups` row, resolve the facility via
 * `non_metered_lines` (same client/supplier/category/input_type/facility name).
 */
export async function resolveNonMeteredCoverageWithoutFacilityGroup(
  supabase: SupabaseClient,
  params: {
    clientId: string;
    clientName: string;
    facilityName: string;
    supplierId: string;
    supplierName: string;
    categoryId: string;
    categoryName: string;
    inputTypeId: string;
    inputTypeName: string;
  }
): Promise<{ ok: true; facilityId: string } | { ok: false; error: string; status: number }> {
  const facTrimmed = params.facilityName.trim();
  if (!facTrimmed) {
    return { ok: false, error: 'Row is missing Facility', status: 422 };
  }

  const { data: facility, error: facErr } = await supabase
    .from('facilities')
    .select('id')
    .eq('client_id', params.clientId)
    .ilike('name', facTrimmed)
    .limit(1)
    .maybeSingle();

  if (facErr) {
    return { ok: false, error: facErr.message, status: 500 };
  }
  if (!facility) {
    return {
      ok: false,
      error: `Facility "${params.facilityName}" not found for client "${params.clientName}"`,
      status: 404,
    };
  }

  const facilityId = String(facility.id);

  const { data: line, error: lineErr } = await supabase
    .from('non_metered_lines')
    .select('id')
    .eq('facility_id', facilityId)
    .eq('supplier_id', params.supplierId)
    .eq('input_type_id', params.inputTypeId)
    .eq('category_id', params.categoryId)
    .limit(1)
    .maybeSingle();

  if (lineErr) {
    return { ok: false, error: lineErr.message, status: 500 };
  }

  if (!line) {
    return {
      ok: false,
      error: `No facility group for "${params.clientName}" / "${params.supplierName}" / "${params.categoryName}" and no matching non_metered_lines row for facility "${params.facilityName}" with Input Type "${params.inputTypeName}".`,
      status: 404,
    };
  }

  return { ok: true, facilityId };
}
