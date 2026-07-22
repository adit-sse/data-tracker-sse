import { NextResponse } from 'next/server';
import { lookupClientAndSupplier } from '@/lib/name-lookup';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { resolveIngestionLine } from '@/lib/ingestion-line';
import { findCategoryForIngestion } from '@/lib/ingestion-utility-category';
import {
  getCurrentFiscalYearMonthsThroughNow,
  monthsFromIsoThroughNow,
  seedIngestionPendingNonMeteredLineMonths,
} from '@/lib/non-metered-pending-seed';
import { seedNonMeteredFacilityGroupPending, type GroupPendingMember } from '@/lib/ingestion-group-pending';
import { seedAllScope1NonMeteredPending } from '@/lib/ingestion-pending-scope1';
import { upsertPendingMonthSlots } from '@/lib/meter-month-slots';
import { checkApiKey } from '@/lib/ingestion-auth';
import { logIngestionFromResponse } from '@/lib/ingestion-events';
import type { IdentifierType } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

  const fallbackMonths = getCurrentFiscalYearMonthsThroughNow();
  if (fallbackMonths.length === 0) {
    return { ok: true, meters: candidateMeters.length, created: 0, skipped: 0 };
  }

  const meterIdList = candidateMeters.map((m: any) => String(m.id));

  // Each meter's pending range starts at its earliest real record (behaviour
  // from #56), falling back to current-FY-through-now for meters with none.
  // One bulk query, reduced client-side — no per-meter round trip.
  // PENDING/ERROR no longer live in actual_invoices (migration 019), so this
  // now reflects genuine data start rather than prior seeding.
  const { data: recordRows } = await supabase
    .from('actual_invoices')
    .select('meter_id, period_start_date')
    .in('meter_id', meterIdList);

  const earliestByMeter = new Map<string, string>();
  for (const r of recordRows ?? []) {
    const id = String(r.meter_id);
    const ps = String(r.period_start_date).slice(0, 10);
    const prev = earliestByMeter.get(id);
    if (!prev || ps < prev) earliestByMeter.set(id, ps);
  }

  // Upsert a PENDING slot per meter × month over that meter's own range.
  // ignoreDuplicates means existing ERROR/DEACTIVATED slots are untouched;
  // only absent slots get created.
  let totalCreated = 0;
  await Promise.all(
    candidateMeters.map((meter: any) => {
      const earliest = earliestByMeter.get(String(meter.id));
      const months = earliest ? monthsFromIsoThroughNow(earliest) : fallbackMonths;
      if (months.length === 0) return Promise.resolve();
      totalCreated += months.length;
      return upsertPendingMonthSlots(
        supabase,
        String(meter.id),
        months[0].start,
        months[months.length - 1].end
      );
    })
  );

  return { ok: true, meters: candidateMeters.length, created: totalCreated, skipped: 0 };
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
function scopeKindForPending(body: Record<string, unknown>): string | null {
  if (body.mode === 'line') return 'line';
  if (body.identifier_type && body.lookup1) return 'metered';
  return 'group';
}

async function handlePending(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
  pendingReceivedAt: string
): Promise<NextResponse> {
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
        String(client_name),
        facilityTrimmed,
        String(supplier_name),
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

      const { created, skipped } = await seedIngestionPendingNonMeteredLineMonths(supabase, {
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
        skipped,
      });
    }

    // ── Mode: specific meter (identifier_type + lookup1 provided) ────────────
    if (identifier_type && lookup1) {
      const { resolveMeterForIngestion, earliestMeterMonthStart } = await import('@/lib/ingestion-metered');
      const resolved = await resolveMeterForIngestion(supabase, {
        clientName: String(client_name),
        facilityName: facilityTrimmed,
        supplierName: String(supplier_name),
        utilityName: utilityTrimmed,
        identifierType: identifier_type as import('@/types').IdentifierType,
        lookup1: String(lookup1),
        lookup2: lookup2 != null ? String(lookup2) : null,
      });

      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: resolved.status });
      }

      // Seed from this meter's earliest real record (behaviour from #56),
      // falling back to current-FY-through-now when it has none.
      const earliest = await earliestMeterMonthStart(supabase, resolved.meterId);
      const months = earliest ? monthsFromIsoThroughNow(earliest) : getCurrentFiscalYearMonthsThroughNow();
      if (months.length > 0) {
        await upsertPendingMonthSlots(
          supabase,
          resolved.meterId,
          months[0].start,
          months[months.length - 1].end
        );
      }

      return NextResponse.json({
        mode: 'metered',
        meter_id: resolved.meterId,
        created: months.length,
        skipped: 0,
      });
    }

    // ── Bulk mode: run non-metered AND metered paths in parallel ─────────────
    //
    // Resolve client + supplier IDs first (both paths need them).
    const resolved = await lookupClientAndSupplier(
      supabase,
      String(client_name),
      String(supplier_name)
    );

    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const { client, supplier } = resolved;

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
      const nmResult = await seedAllScope1NonMeteredPending(
        supabase,
        String(client_name),
        String(supplier_name),
        pendingReceivedAt
      );
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
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createSupabaseServiceRoleClient();
  const pendingReceivedAt = new Date().toISOString();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const res = NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    await logIngestionFromResponse(supabase, {
      endpoint: 'pending',
      scopeKind: null,
      request: null,
      response: res,
      startedAt,
    });
    return res;
  }

  const reqBody = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const scopeKind = scopeKindForPending(reqBody);

  try {
    const res = await handlePending(supabase, reqBody, pendingReceivedAt);
    await logIngestionFromResponse(supabase, {
      endpoint: 'pending',
      scopeKind,
      request: body,
      response: res,
      startedAt,
    });
    return res;
  } catch (error) {
    console.error('Error in ingestion/pending:', error);
    const res = NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    await logIngestionFromResponse(supabase, {
      endpoint: 'pending',
      scopeKind,
      request: body,
      response: res,
      startedAt,
    });
    return res;
  }
}
