import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getCurrentFiscalYearMonthsThroughNow,
  seedIngestionPendingNonMeteredLineMonths,
} from '@/lib/non-metered-pending-seed';
import { seedNonMeteredFacilityGroupPending, type GroupPendingMember } from '@/lib/ingestion-group-pending';

type CategoryEmbed = { id: string; name: string; scope: number } | { id: string; name: string; scope: number }[] | null;

function firstCategory(category: CategoryEmbed): { id: string; name: string; scope: number } | null {
  if (!category) return null;
  return Array.isArray(category) ? category[0] ?? null : category;
}

/**
 * Seeds PENDING rows for all Scope 1 non-metered coverage for a client + supplier:
 * every facility group whose NGERS category is Scope 1, and every standalone
 * non_metered_lines row whose input type is Scope 1 (excluding lines that belong to a group).
 */
export async function seedAllScope1NonMeteredPending(
  supabase: SupabaseClient,
  clientName: string,
  supplierName: string,
  pendingReceivedAt?: string
): Promise<
  | {
      ok: true;
      client_id: string;
      supplier_id: string;
      groups: Array<{ category_name: string | null; created: number; skipped: number }>;
      lines: Array<{
        input_type_name: string;
        facility_name: string;
        created: number;
        skipped: number;
        resolved: {
          facility_id: string;
          facility_name: string;
          supplier_id: string;
          input_type_id: string;
        };
      }>;
      summary: { created: number; skipped: number };
    }
  | { ok: false; error: string; status: number }
> {
  const [{ data: client }, { data: supplier }] = await Promise.all([
    supabase.from('clients').select('id').ilike('name', clientName).single(),
    supabase.from('suppliers').select('id').ilike('name', supplierName).single(),
  ]);

  if (!client) {
    return { ok: false, error: `Client "${clientName}" not found`, status: 404 };
  }
  if (!supplier) {
    return { ok: false, error: `Supplier "${supplierName}" not found`, status: 404 };
  }

  const { data: facilities, error: facErr } = await supabase
    .from('facilities')
    .select('id')
    .eq('client_id', client.id);

  if (facErr) {
    return { ok: false, error: facErr.message, status: 500 };
  }

  const facilityIds = (facilities ?? []).map((f: { id: string }) => f.id);

  const { data: groupRows, error: groupErr } = await supabase
    .from('facility_groups')
    .select(
      `
      id,
      category_id,
      category:categories(id, name, scope),
      members:facility_group_members(
        non_metered_line_id,
        line:non_metered_lines(facility_id, input_type_id)
      )
    `
    )
    .eq('client_id', client.id)
    .eq('supplier_id', supplier.id);

  if (groupErr) {
    return { ok: false, error: groupErr.message, status: 500 };
  }

  const groupedLineIds = new Set<string>();
  for (const g of groupRows ?? []) {
    const members = (g as { members?: { non_metered_line_id?: string | null }[] | null }).members ?? [];
    for (const m of members) {
      if (m.non_metered_line_id) groupedLineIds.add(String(m.non_metered_line_id));
    }
  }

  const groupsOut: Array<{ category_name: string | null; created: number; skipped: number }> = [];
  let sumCreated = 0;
  let sumSkipped = 0;

  for (const g of groupRows ?? []) {
    const cat = firstCategory((g as { category?: CategoryEmbed }).category ?? null);
    if (!cat || cat.scope !== 1 || !(g as { category_id?: string | null }).category_id) {
      continue;
    }

    const rawMembers = (g as { members?: unknown[] | null }).members ?? [];
    const members: GroupPendingMember[] = (rawMembers as any[])
      .map((m: any) => ({
        facility_id: m.line?.facility_id,
        input_type_id: m.line?.input_type_id,
      }))
      .filter((m): m is GroupPendingMember => !!m.facility_id && !!m.input_type_id);

    if (members.length === 0) {
      continue;
    }

    const { created, skipped } = await seedNonMeteredFacilityGroupPending(
      supabase,
      supplier.id,
      members,
      pendingReceivedAt
    );
    sumCreated += created;
    sumSkipped += skipped;
    groupsOut.push({
      category_name: cat.name,
      created,
      skipped,
    });
  }

  const linesOut: Array<{
    input_type_name: string;
    facility_name: string;
    created: number;
    skipped: number;
    resolved: {
      facility_id: string;
      facility_name: string;
      supplier_id: string;
      input_type_id: string;
    };
  }> = [];

  if (facilityIds.length > 0) {
    const { data: lineRows, error: linesErr } = await supabase
      .from('non_metered_lines')
      .select(
        `
        id,
        facility_id,
        input_type_id,
        input_types(id, name, scope),
        facility:facilities(id, name)
      `
      )
      .eq('supplier_id', supplier.id)
      .in('facility_id', facilityIds);

    if (linesErr) {
      return { ok: false, error: linesErr.message, status: 500 };
    }

    const months = getCurrentFiscalYearMonthsThroughNow();

    for (const row of lineRows ?? []) {
      const r = row as {
        id: string;
        facility_id: string;
        input_type_id: string;
        input_types: { id: string; name: string; scope: number } | { id: string; name: string; scope: number }[] | null;
        facility: { id: string; name: string } | { id: string; name: string }[] | null;
      };

      if (groupedLineIds.has(String(r.id))) continue;

      const itRaw = r.input_types;
      const it = Array.isArray(itRaw) ? itRaw[0] : itRaw;
      if (!it || typeof it.scope !== 'number' || it.scope !== 1) continue;

      const facRaw = r.facility;
      const fac = Array.isArray(facRaw) ? facRaw[0] : facRaw;
      if (!fac?.id) continue;

      const created = await seedIngestionPendingNonMeteredLineMonths(supabase, {
        facilityId: r.facility_id,
        supplierId: supplier.id,
        inputTypeId: r.input_type_id,
        pendingReceivedAt,
      });

      sumCreated += created;
      const skipped = months.length - created;
      sumSkipped += skipped;

      linesOut.push({
        input_type_name: it.name,
        facility_name: fac.name,
        created,
        skipped,
        resolved: {
          facility_id: fac.id,
          facility_name: fac.name,
          supplier_id: supplier.id,
          input_type_id: r.input_type_id,
        },
      });
    }
  }

  if (groupsOut.length === 0 && linesOut.length === 0) {
    return {
      ok: false,
      error: `No Scope 1 non-metered coverage found for client "${clientName}" and supplier "${supplierName}".`,
      status: 404,
    };
  }

  return {
    ok: true,
    client_id: client.id,
    supplier_id: supplier.id,
    groups: groupsOut,
    lines: linesOut,
    summary: { created: sumCreated, skipped: sumSkipped },
  };
}
