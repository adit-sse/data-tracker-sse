import { NextResponse } from 'next/server';
import { lookupClientAndSupplier } from '@/lib/name-lookup';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import {
  resolveIngestionLine,
  resolveIngestionScope,
  rejectMeteredInputTypeOnLinePath,
} from '@/lib/ingestion-line';
import { resolveMeterForIngestion } from '@/lib/ingestion-metered';
import { deletePendingMonthSlots } from '@/lib/meter-month-slots';
import { checkApiKey } from '@/lib/ingestion-auth';
import { logIngestionFromResponse } from '@/lib/ingestion-events';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IdentifierType } from '@/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface GroupMember {
  line: {
    facility_id: string | number;
    input_type_id: string | null;
  } | null;
}

interface MeterRow {
  id: string;
  input_type: { name: string } | { name: string }[] | null;
}

// POST /api/ingestion/revert-pending
//
// Runs at the very END of a group/line confirm workflow, after /confirm (or
// /unified-confirm) and /inferred-empty. Any record still PENDING for the scope
// is deleted, reverting it back to "no data" (the UI renders a month with no
// record as "No data"). CONFIRMED and INFERRED_EMPTY records are left untouched.
//
// This is deliberately a separate step: /unified-confirm processes all rows at
// once, so we cannot revert leftover pendings mid-confirm without breaking the
// PENDING→CONFIRMED lookups the confirm relies on. inferred-empty only converts
// pendings in months that got a CONFIRMED record; this endpoint clears whatever
// PENDING remains after that (e.g. months where nothing was confirmed).
//
// Group mode (default):
//   { client_name, supplier_name, category }
//   Covers ALL input types within the facility group.
//
// Line mode:
//   { mode: "line", client_name, supplier_name, input_type [, facility_name] }
//   Targets a single standalone non_metered_lines row (not in a group).
//
// Metered mode:
//   { mode: "metered", client_name, supplier_name [, utility_name, facility_name, identifier_type, lookup1, lookup2] }
//   Deletes PENDING rows in actual_invoices for the matched meters. With
//   identifier_type + lookup1, targets one specific meter; otherwise sweeps every
//   meter for this client+supplier (narrowable by utility_name / facility_name).
//   Mirrors the scope resolution of the metered pending seeder. CONFIRMED / GREEN
//   invoices are left untouched — confirmed months already had their PENDING
//   consumed by /unified-confirm, so this only clears the unconfirmed leftovers.
async function handleRevertPending(
  supabase: SupabaseClient,
  body: Record<string, unknown>
): Promise<NextResponse> {
  const {
    mode,
    client_name,
    supplier_name,
    category,
    input_type,
    utility_name,
    identifier_type,
    lookup1,
    lookup2,
  } = body;

  // The n8n metered node sends `facility` (the NGERS column), not `facility_name`.
  // Accept either so the site is used rather than silently dropped — an unread key
  // would leave facility resolution to fall back to the identifier, which only
  // matters (as a 409) when the same NMI exists at two of the client's sites.
  const facility_name = body.facility_name ?? body.facility;

  if (!client_name || !supplier_name) {
    return NextResponse.json(
      { error: 'client_name and supplier_name are required' },
      { status: 400 }
    );
  }

  // ── LINE MODE ────────────────────────────────────────────────────────────────
  if (mode === 'line') {
    if (!input_type) {
      return NextResponse.json(
        { error: 'input_type is required for line mode' },
        { status: 400 }
      );
    }

    // Reject a metered utility before searching non_metered_lines for it — that
    // search cannot succeed for a meter's input type, and its 404 reads as missing
    // configuration rather than the wrong mode.
    const scopeResolved = await resolveIngestionScope(
      supabase,
      String(client_name),
      String(supplier_name),
      String(input_type)
    );
    if (!scopeResolved.ok) {
      return NextResponse.json({ error: scopeResolved.error }, { status: scopeResolved.status });
    }
    const metered = rejectMeteredInputTypeOnLinePath(scopeResolved.scope);
    if (metered) {
      return NextResponse.json({ error: metered.error }, { status: metered.status });
    }

    const resolved = await resolveIngestionLine(
      supabase,
      String(client_name),
      typeof facility_name === 'string' ? facility_name.trim() : '',
      String(supplier_name),
      String(input_type),
      // This path deletes. Without configured coverage there is nothing to revert,
      // and resolving anyway would return a reassuring "reverted: 0".
      { requireLineCoverage: true }
    );

    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const { facilityId, supplierId, categoryId } = resolved;

    const { data: deleted, error: delErr } = await supabase
      .from('non_metered_records')
      .delete()
      .eq('facility_id', facilityId)
      .eq('supplier_id', supplierId)
      .eq('input_type_id', categoryId)
      .eq('status', 'PENDING')
      .select('id');

    if (delErr) throw new Error(delErr.message);

    return NextResponse.json({
      mode: 'line',
      reverted: deleted?.length ?? 0,
    });
  }

  // ── METERED MODE ─────────────────────────────────────────────────────────────
  if (mode === 'metered') {
    const utilityTrimmed = typeof utility_name === 'string' ? utility_name.trim() : '';
    const facilityTrimmed = typeof facility_name === 'string' ? facility_name.trim() : '';

    const resolved = await lookupClientAndSupplier(
      supabase,
      String(client_name),
      String(supplier_name)
    );

    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const { client, supplier } = resolved;

    // Specific meter by identifier — mirrors the pending endpoint's metered path.
    if (identifier_type && lookup1) {
      const resolved = await resolveMeterForIngestion(supabase, {
        clientName: String(client_name),
        facilityName: facilityTrimmed,
        supplierName: String(supplier_name),
        utilityName: utilityTrimmed,
        identifierType: identifier_type as IdentifierType,
        lookup1: String(lookup1),
        lookup2: lookup2 != null ? String(lookup2) : null,
      });

      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: resolved.status });
      }

      const reverted = await deletePendingMonthSlots(supabase, [resolved.meterId]);

      return NextResponse.json({
        mode: 'metered',
        meter_id: resolved.meterId,
        reverted,
      });
    }

    // Bulk: every meter for this client+supplier, optionally narrowed.
    const { data: facilities } = await supabase
      .from('facilities')
      .select('id, name')
      .eq('client_id', client.id);

    let candidateFacilities = facilities ?? [];
    if (facilityTrimmed) {
      const lower = facilityTrimmed.toLowerCase();
      candidateFacilities = candidateFacilities.filter(
        (f: { id: string; name: string }) => f.name.toLowerCase() === lower
      );
      if (candidateFacilities.length === 0) {
        return NextResponse.json(
          { error: `Facility "${facilityTrimmed}" not found for this client` },
          { status: 404 }
        );
      }
    }

    const facilityIds = candidateFacilities.map((f: { id: string }) => f.id);
    if (facilityIds.length === 0) {
      return NextResponse.json({ mode: 'metered', meters: 0, reverted: 0 });
    }

    const { data: meters, error: metersErr } = await supabase
      .from('meters')
      .select('id, input_type:input_types(name)')
      .in('facility_id', facilityIds)
      .eq('supplier_id', supplier.id);

    if (metersErr) throw new Error(metersErr.message);

    const allMeters = meters ?? [];
    let candidateMeters = allMeters;
    if (utilityTrimmed) {
      const lower = utilityTrimmed.toLowerCase();
      candidateMeters = candidateMeters.filter((m: MeterRow) => {
        const name = (Array.isArray(m.input_type) ? m.input_type[0] : m.input_type)?.name;
        return typeof name === 'string' && name.toLowerCase() === lower;
      });

      // Meters exist but none carry that input type — the filter is wrong, so say so.
      // Reporting "reverted: 0" here looks like a clean sweep of an empty scope.
      // Matches the same check in POST /api/ingestion/pending.
      if (candidateMeters.length === 0 && allMeters.length > 0) {
        return NextResponse.json(
          {
            error:
              `No meters found with input type "${utilityTrimmed}" for this client and supplier. ` +
              `${allMeters.length} meter(s) exist for the pair under other input types.`,
          },
          { status: 400 }
        );
      }
    }

    if (candidateMeters.length === 0) {
      return NextResponse.json({ mode: 'metered', meters: 0, reverted: 0 });
    }

    const meterIds = candidateMeters.map((m: MeterRow) => String(m.id));

    const totalReverted = await deletePendingMonthSlots(supabase, meterIds);

    return NextResponse.json({
      mode: 'metered',
      meters: candidateMeters.length,
      reverted: totalReverted,
    });
  }

  // ── GROUP MODE ───────────────────────────────────────────────────────────────
  if (!category) {
    return NextResponse.json(
      { error: 'category is required for group mode (or pass mode: "line" / mode: "metered")' },
      { status: 400 }
    );
  }

  const [clientSupplier, { data: groupCategory }] = await Promise.all([
    lookupClientAndSupplier(supabase, String(client_name), String(supplier_name)),
    supabase.from('categories').select('id').ilike('name', String(category)).single(),
  ]);

  if (!clientSupplier.ok) {
    return NextResponse.json({ error: clientSupplier.error }, { status: clientSupplier.status });
  }
  const { client, supplier } = clientSupplier;
  if (!groupCategory) return NextResponse.json({ error: `Category "${category}" not found` }, { status: 404 });

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

  if (!group) {
    return NextResponse.json(
      { error: `No group found for "${client_name}" / "${supplier_name}" / "${category}"` },
      { status: 404 }
    );
  }

  const members = (group.members ?? []) as unknown as GroupMember[];
  const allMemberFacilityIds: string[] = [];

  for (const member of members) {
    const line = member.line;
    if (!line || !line.input_type_id) continue;
    allMemberFacilityIds.push(String(line.facility_id));
  }

  if (allMemberFacilityIds.length === 0) {
    return NextResponse.json(
      { error: 'Group has no member facilities with input types configured' },
      { status: 422 }
    );
  }

  const { data: deleted, error: delErr } = await supabase
    .from('non_metered_records')
    .delete()
    .in('facility_id', allMemberFacilityIds)
    .eq('supplier_id', supplier.id)
    .eq('status', 'PENDING')
    .select('id');

  if (delErr) throw new Error(delErr.message);

  return NextResponse.json({
    mode: 'group',
    reverted: deleted?.length ?? 0,
  });
}

function scopeKindForRevertPending(body: Record<string, unknown>): string | null {
  if (body.mode === 'line') return 'line';
  if (body.mode === 'metered') return 'metered';
  return 'group';
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createSupabaseServiceRoleClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const res = NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    await logIngestionFromResponse(supabase, {
      endpoint: 'revert-pending',
      scopeKind: null,
      request: null,
      response: res,
      startedAt,
    });
    return res;
  }

  const reqBody = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const scopeKind = scopeKindForRevertPending(reqBody);

  try {
    const res = await handleRevertPending(supabase, reqBody);
    await logIngestionFromResponse(supabase, {
      endpoint: 'revert-pending',
      scopeKind,
      request: body,
      response: res,
      startedAt,
    });
    return res;
  } catch (error) {
    console.error('Error in ingestion/revert-pending:', error);
    const detail = error instanceof Error ? error.message : String(error);
    const res = NextResponse.json({ error: 'Internal server error', detail }, { status: 500 });
    await logIngestionFromResponse(supabase, {
      endpoint: 'revert-pending',
      scopeKind,
      request: body,
      response: res,
      startedAt,
    });
    return res;
  }
}
