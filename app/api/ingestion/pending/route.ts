import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { resolveIngestionLine } from '@/lib/ingestion-line';
import { findCategoryForIngestion } from '@/lib/ingestion-utility-category';
import {
  getCurrentFiscalYearMonthsThroughNow,
  seedIngestionPendingNonMeteredLineMonths,
} from '@/lib/non-metered-pending-seed';
import { seedNonMeteredFacilityGroupPending, type GroupPendingMember } from '@/lib/ingestion-group-pending';
import { seedAllScope1NonMeteredPending } from '@/lib/ingestion-pending-scope1';
import { meterMonthBlocksNewPending } from '@/lib/ingestion-metered';
import type { SupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function checkApiKey(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === process.env.INGESTION_API_KEY;
}

type MeteredPendingOk = { ok: true; meters: number; created: number; skipped: number };
type MeteredPendingError = { ok: false; error: string; status: number };
type MeteredPendingResult = MeteredPendingOk | MeteredPendingError;

/**
 * Seeds PENDING rows in actual_invoices for every meter belonging to this
 * client+supplier pair. Optionally narrows by utility name (input type),
 * facility name, or a specific identifier (identifier_type + lookup1).
 *
 * Returns a hard error if:
 *   - facility_name is provided but no matching facility exists for this client → 404
 *   - utility_name is provided AND meters exist for this supplier but none match → 400
 */
async function seedMeteredPending(
  supabase: SupabaseClient,
  clientId: string,
  supplierId: string,
  filters: {
    utilityName?: string;
    facilityName?: string;
    identifierType?: string;
    lookup1?: string;
  },
  pendingReceivedAt: string
): Promise<MeteredPendingResult> {
  const { data: facilities } = await supabase
    .from('facilities')
    .select('id, name')
    .eq('client_id', clientId);

  let candidateFacilities = facilities ?? [];

  if (filters.facilityName) {
    const lower = filters.facilityName.toLowerCase();
    candidateFacilities = candidateFacilities.filter(
      (f: { id: string; name: string }) => f.name.toLowerCase() === lower
    );
    if (candidateFacilities.length === 0) {
      return {
        ok: false,
        error: `Facility "${filters.facilityName}" not found for this client`,
        status: 404,
      };
    }
  }

  const facilityIds = candidateFacilities.map((f: { id: string }) => f.id);
  if (facilityIds.length === 0) return { ok: true, meters: 0, created: 0, skipped: 0 };

  let metersQuery = supabase
    .from('meters')
    .select('id, identifier_type, lookup1, input_type:input_types(name)')
    .in('facility_id', facilityIds)
    .eq('supplier_id', supplierId);

  if (filters.identifierType && filters.lookup1) {
    metersQuery = metersQuery
      .eq('identifier_type', filters.identifierType)
      .eq('lookup1', filters.lookup1);
  }

  const { data: meters, error: metersErr } = await metersQuery;
  if (metersErr) throw new Error(metersErr.message);

  const allMeters = meters ?? [];
  let candidateMeters = allMeters;

  if (filters.utilityName) {
    const lower = filters.utilityName.toLowerCase();
    candidateMeters = candidateMeters.filter((m: any) => {
      const name = (Array.isArray(m.input_type) ? m.input_type[0] : m.input_type)?.name;
      return typeof name === 'string' && name.toLowerCase() === lower;
    });

    // Only error if meters exist for this supplier but none match the requested input type.
    // If there are no meters at all, this is a non-metered supplier — not an error.
    if (candidateMeters.length === 0 && allMeters.length > 0) {
      return {
        ok: false,
        error: `No meters found with input type "${filters.utilityName}" for this client and supplier`,
        status: 400,
      };
    }
  }

  if (candidateMeters.length === 0) return { ok: true, meters: 0, created: 0, skipped: 0 };

  const months = getCurrentFiscalYearMonthsThroughNow();
  let totalCreated = 0;
  let totalSkipped = 0;

  for (const meter of candidateMeters) {
    const toInsert: Array<{
      meter_id: string;
      period_start_date: string;
      period_end_date: string;
      status: string;
      created_at: string;
    }> = [];

    for (const month of months) {
      if (await meterMonthBlocksNewPending(supabase, meter.id, month.start, month.end)) {
        totalSkipped++;
        continue;
      }
      toInsert.push({
        meter_id: meter.id,
        period_start_date: month.start,
        period_end_date: month.end,
        status: 'PENDING',
        created_at: pendingReceivedAt,
      });
    }

    if (toInsert.length > 0) {
      const { error: insertErr } = await supabase.from('actual_invoices').insert(toInsert);
      if (insertErr) throw new Error(insertErr.message);
      totalCreated += toInsert.length;
    }
  }

  return { ok: true, meters: candidateMeters.length, created: totalCreated, skipped: totalSkipped };
}

// POST /api/ingestion/pending
//
// Unified endpoint — handles Scope 1 non-metered AND metered (Scope 2) in one call.
//
// Minimum body: { client_name, supplier_name }
//   Seeds all Scope 1 non-metered coverage AND all metered coverage for this pair.
//   Suppliers with only one type return zeros for the other — not an error.
//
// Optional narrowing (all optional, combinable):
//   utility_name     — non-metered: targets one NGERS group/line; metered: filters by input type name
//   facility_name    — narrows to one facility (404 if not found)
//   mode: "line"     — non-metered standalone line path only (existing behaviour)
//   identifier_type + lookup1  — targets a single specific meter only
//
// Hard errors returned for:
//   - client_name not found → 404
//   - supplier_name not found → 404
//   - facility_name provided but not found for this client → 404
//   - utility_name provided and meters exist but none match that input type → 400
//   - utility_name provided but not found as NGERS category AND no metered coverage → 400
export async function POST(request: Request) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const pendingReceivedAt = new Date().toISOString();
    const supabase = createSupabaseServiceRoleClient();
    const body = await request.json();
    const { client_name, supplier_name, utility_name, mode, facility_name, identifier_type, lookup1, lookup2 } =
      body;

    if (!client_name || !supplier_name) {
      return NextResponse.json(
        { error: 'client_name and supplier_name are required' },
        { status: 400 }
      );
    }

    const utilityTrimmed = typeof utility_name === 'string' ? utility_name.trim() : '';
    const facilityTrimmed = typeof facility_name === 'string' ? facility_name.trim() : '';

    // ── Mode: standalone non-metered line (unchanged) ────────────────────────
    if (mode === 'line') {
      const resolved = await resolveIngestionLine(
        supabase,
        client_name,
        facilityTrimmed,
        supplier_name,
        utilityTrimmed
      );
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: resolved.status });
      }

      const { data: itRow } = await supabase
        .from('input_types')
        .select('scope')
        .eq('id', resolved.categoryId)
        .maybeSingle();

      if (typeof itRow?.scope !== 'number' || itRow.scope !== 1) {
        return NextResponse.json(
          { error: 'mode: "line" only supports Scope 1 input types.' },
          { status: 400 }
        );
      }

      const months = getCurrentFiscalYearMonthsThroughNow();
      const created = await seedIngestionPendingNonMeteredLineMonths(supabase, {
        facilityId: resolved.facilityId,
        supplierId: resolved.supplierId,
        inputTypeId: resolved.categoryId,
        pendingReceivedAt,
      });

      return NextResponse.json({
        mode: 'line',
        scope: 1,
        resolved: {
          facility_id: resolved.facilityId,
          facility_name: resolved.facilityName,
          supplier_id: resolved.supplierId,
          input_type_id: resolved.categoryId,
        },
        created,
        skipped: months.length - created,
      });
    }

    // ── Mode: specific meter (identifier_type + lookup1 provided) ────────────
    if (identifier_type && lookup1) {
      const { resolveMeterForIngestion } = await import('@/lib/ingestion-metered');
      const resolved = await resolveMeterForIngestion(supabase, {
        clientName: client_name,
        facilityName: facilityTrimmed,
        supplierName: supplier_name,
        utilityName: utilityTrimmed,
        identifierType: identifier_type,
        lookup1: String(lookup1),
        lookup2: lookup2 ?? null,
      });

      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: resolved.status });
      }

      const months = getCurrentFiscalYearMonthsThroughNow();
      const toInsert: Array<{
        meter_id: string;
        period_start_date: string;
        period_end_date: string;
        status: string;
        created_at: string;
      }> = [];

      for (const month of months) {
        if (await meterMonthBlocksNewPending(supabase, resolved.meterId, month.start, month.end)) {
          continue;
        }
        toInsert.push({
          meter_id: resolved.meterId,
          period_start_date: month.start,
          period_end_date: month.end,
          status: 'PENDING',
          created_at: pendingReceivedAt,
        });
      }

      if (toInsert.length > 0) {
        const { error: insertError } = await supabase.from('actual_invoices').insert(toInsert);
        if (insertError) throw insertError;
      }

      return NextResponse.json({
        mode: 'metered',
        meter_id: resolved.meterId,
        created: toInsert.length,
        skipped: months.length - toInsert.length,
      });
    }

    // ── Bulk mode: run non-metered AND metered paths in parallel ─────────────
    //
    // Resolve client + supplier IDs first (both paths need them).
    const [{ data: client }, { data: supplier }] = await Promise.all([
      supabase.from('clients').select('id').ilike('name', client_name).single(),
      supabase.from('suppliers').select('id').ilike('name', supplier_name).single(),
    ]);

    if (!client) return NextResponse.json({ error: `Client "${client_name}" not found` }, { status: 404 });
    if (!supplier) return NextResponse.json({ error: `Supplier "${supplier_name}" not found` }, { status: 404 });

    // ── Non-metered path ─────────────────────────────────────────────────────
    let nonMeteredResult: {
      groups: Array<{ category_name: string | null; created: number; skipped: number }>;
      lines: Array<{ input_type_name: string; facility_name: string; created: number; skipped: number }>;
      summary: { created: number; skipped: number };
    } = { groups: [], lines: [], summary: { created: 0, skipped: 0 } };

    // Track whether a targeted category lookup failed, so we can surface it
    // if the metered path also finds nothing.
    let categoryLookupError: string | null = null;

    if (!utilityTrimmed) {
      // Bulk Scope 1
      const nmResult = await seedAllScope1NonMeteredPending(supabase, client_name, supplier_name, pendingReceivedAt);
      if (nmResult.ok) {
        nonMeteredResult = {
          groups: nmResult.groups,
          lines: nmResult.lines,
          summary: nmResult.summary,
        };
      }
      // status 404 = no Scope 1 coverage for this supplier — not an error in unified mode
    } else {
      // Targeted group (utility_name = NGERS category name).
      // utility_name can also be an input type name for the metered path, so a category
      // lookup miss is only surfaced as an error if the metered path also finds nothing.
      let groupCategory: { id: string; scope: number };
      try {
        groupCategory = await findCategoryForIngestion(supabase, utilityTrimmed);
      } catch (e) {
        categoryLookupError = e instanceof Error ? e.message : String(e);
        groupCategory = { id: '', scope: 0 };
      }

      if (groupCategory.id && groupCategory.scope === 1) {
        const { data: group } = await supabase
          .from('facility_groups')
          .select(`
            id,
            members:facility_group_members(
              line:non_metered_lines(facility_id, input_type_id)
            )
          `)
          .eq('client_id', client.id)
          .eq('supplier_id', supplier.id)
          .eq('category_id', groupCategory.id)
          .single();

        if (group) {
          const members: GroupPendingMember[] = ((group.members ?? []) as any[])
            .map((m: any) => ({
              facility_id: m.line?.facility_id,
              input_type_id: m.line?.input_type_id,
            }))
            .filter((m): m is GroupPendingMember => !!m.facility_id && !!m.input_type_id);

          if (members.length > 0) {
            const { created, skipped } = await seedNonMeteredFacilityGroupPending(
              supabase,
              supplier.id,
              members,
              pendingReceivedAt
            );
            nonMeteredResult = {
              groups: [{ category_name: utilityTrimmed, created, skipped }],
              lines: [],
              summary: { created, skipped },
            };
          }
        }
      }
    }

    // ── Metered path ─────────────────────────────────────────────────────────
    const meteredResult = await seedMeteredPending(supabase, client.id, supplier.id, {
      utilityName: utilityTrimmed || undefined,
      facilityName: facilityTrimmed || undefined,
    }, pendingReceivedAt);

    // Facility not found or input type not found — hard error regardless of non-metered result
    if (!meteredResult.ok) {
      return NextResponse.json({ error: meteredResult.error }, { status: meteredResult.status });
    }

    // Nothing found on either side
    if (
      nonMeteredResult.summary.created === 0 &&
      nonMeteredResult.summary.skipped === 0 &&
      meteredResult.meters === 0
    ) {
      // Surface the category lookup failure if that's what caused the non-metered path to find nothing
      const errorMsg = categoryLookupError
        ? `${categoryLookupError} Also no metered coverage found for client "${client_name}" and supplier "${supplier_name}".`
        : `No coverage found for client "${client_name}" and supplier "${supplier_name}". Check that meters or non-metered lines are configured for this pair.`;

      return NextResponse.json({ error: errorMsg }, { status: 404 });
    }

    return NextResponse.json({
      client_id: client.id,
      supplier_id: supplier.id,
      non_metered: nonMeteredResult,
      metered: meteredResult,
    });
  } catch (error) {
    console.error('Error in ingestion/pending:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
