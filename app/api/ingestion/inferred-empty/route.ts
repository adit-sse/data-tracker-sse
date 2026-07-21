import { NextResponse } from 'next/server';
import { lookupClientAndSupplier } from '@/lib/name-lookup';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { resolveIngestionLine } from '@/lib/ingestion-line';
import { checkApiKey } from '@/lib/ingestion-auth';
import { logIngestionFromResponse } from '@/lib/ingestion-events';
import type { SupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function periodKey(d: string | null | undefined): string {
  if (!d) return '';
  return String(d).slice(0, 10);
}

interface GroupMember {
  line: {
    facility_id: string | number;
    input_type_id: string | null;
  } | null;
}

// POST /api/ingestion/inferred-empty

//
// Call after all per-facility invoices for a period have been submitted via /confirm.
// For every month that has at least one CONFIRMED record in the scope, any member still
// PENDING for that month is marked INFERRED_EMPTY. Months with no CONFIRMED records at
// all are left completely untouched.
//
// Group mode (default):
//   { client_name, supplier_name, category }
//   Covers ALL input types within the facility group. No need to specify input_type.
//
// Line mode:
//   { mode: "line", client_name, supplier_name, input_type [, facility_name] }
//   Targets a single standalone non_metered_lines row (not in a group).
async function handleInferredEmpty(
  supabase: SupabaseClient,
  body: Record<string, unknown>
): Promise<NextResponse> {
  const { mode, client_name, supplier_name, category, input_type, facility_name } = body;

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

    const resolved = await resolveIngestionLine(
      supabase,
      String(client_name),
      typeof facility_name === 'string' ? facility_name.trim() : '',
      String(supplier_name),
      String(input_type)
    );

    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const { facilityId, supplierId, categoryId } = resolved;

    const { data: records, error: fetchErr } = await supabase
      .from('non_metered_records')
      .select('id, period_start_date, status')
      .eq('facility_id', facilityId)
      .eq('supplier_id', supplierId)
      .eq('input_type_id', categoryId)
      .in('status', ['CONFIRMED', 'PENDING']);

    if (fetchErr) throw new Error(fetchErr.message);

    const allRecords = records ?? [];
    const confirmedPeriodKeys = new Set(
      allRecords.filter((r) => r.status === 'CONFIRMED').map((r) => periodKey(r.period_start_date))
    );

    const toInfer = allRecords.filter(
      (r) => r.status === 'PENDING' && confirmedPeriodKeys.has(periodKey(r.period_start_date))
    );

    if (toInfer.length > 0) {
      const { error: updErr } = await supabase
        .from('non_metered_records')
        .update({ status: 'INFERRED_EMPTY' })
        .in('id', toInfer.map((r) => r.id));
      if (updErr) throw new Error(updErr.message);
    }

    return NextResponse.json({
      mode: 'line',
      inferred_empty: toInfer.length,
      confirmed_periods_checked: confirmedPeriodKeys.size,
    });
  }

  // ── GROUP MODE ───────────────────────────────────────────────────────────────
  if (!category) {
    return NextResponse.json(
      { error: 'category is required for group mode (or pass mode: "line" for standalone lines)' },
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

  // Collect all member facility IDs across all input types.
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

  // Fetch ALL CONFIRMED and PENDING records for every member across every input type.
  const { data: records, error: fetchErr } = await supabase
    .from('non_metered_records')
    .select('id, period_start_date, status')
    .in('facility_id', allMemberFacilityIds)
    .eq('supplier_id', supplier.id)
    .in('status', ['CONFIRMED', 'PENDING']);

  if (fetchErr) throw new Error(fetchErr.message);

  const allRecords = records ?? [];

  // A month is "active" if ANY record in the group is CONFIRMED for it.
  // Every record still PENDING in an active month gets marked INFERRED_EMPTY.
  const confirmedPeriodKeys = new Set(
    allRecords
      .filter((r) => r.status === 'CONFIRMED')
      .map((r) => periodKey(r.period_start_date))
  );

  if (confirmedPeriodKeys.size === 0) {
    return NextResponse.json({
      mode: 'group',
      inferred_empty: 0,
      message: 'No CONFIRMED records found for this group — no months updated.',
    });
  }

  const toInfer = allRecords.filter(
    (r) => r.status === 'PENDING' && confirmedPeriodKeys.has(periodKey(r.period_start_date))
  );

  if (toInfer.length > 0) {
    const { error: updErr } = await supabase
      .from('non_metered_records')
      .update({ status: 'INFERRED_EMPTY' })
      .in('id', toInfer.map((r) => r.id));
    if (updErr) throw new Error(updErr.message);
  }

  return NextResponse.json({
    mode: 'group',
    inferred_empty: toInfer.length,
    confirmed_periods_checked: confirmedPeriodKeys.size,
  });
}

function scopeKindForInferredEmpty(body: Record<string, unknown>): string | null {
  return body.mode === 'line' ? 'line' : 'group';
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
      endpoint: 'inferred-empty',
      scopeKind: null,
      request: null,
      response: res,
      startedAt,
    });
    return res;
  }

  const reqBody = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const scopeKind = scopeKindForInferredEmpty(reqBody);

  try {
    const res = await handleInferredEmpty(supabase, reqBody);
    await logIngestionFromResponse(supabase, {
      endpoint: 'inferred-empty',
      scopeKind,
      request: body,
      response: res,
      startedAt,
    });
    return res;
  } catch (error) {
    console.error('Error in ingestion/inferred-empty:', error);
    const detail = error instanceof Error ? error.message : String(error);
    const res = NextResponse.json({ error: 'Internal server error', detail }, { status: 500 });
    await logIngestionFromResponse(supabase, {
      endpoint: 'inferred-empty',
      scopeKind,
      request: body,
      response: res,
      startedAt,
    });
    return res;
  }
}
