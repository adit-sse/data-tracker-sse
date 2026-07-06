import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { resolveIngestionLine } from '@/lib/ingestion-line';
import { checkApiKey } from '@/lib/ingestion-auth';
import { logIngestionFromResponse } from '@/lib/ingestion-events';
import type { SupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface GroupMember {
  line: {
    facility_id: string | number;
    input_type_id: string | null;
  } | null;
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
async function handleRevertPending(
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

  // ── GROUP MODE ───────────────────────────────────────────────────────────────
  if (!category) {
    return NextResponse.json(
      { error: 'category is required for group mode (or pass mode: "line" for standalone lines)' },
      { status: 400 }
    );
  }

  const [{ data: client }, { data: supplier }, { data: groupCategory }] = await Promise.all([
    supabase.from('clients').select('id').ilike('name', String(client_name)).single(),
    supabase.from('suppliers').select('id').ilike('name', String(supplier_name)).single(),
    supabase.from('categories').select('id').ilike('name', String(category)).single(),
  ]);

  if (!client) return NextResponse.json({ error: `Client "${client_name}" not found` }, { status: 404 });
  if (!supplier) return NextResponse.json({ error: `Supplier "${supplier_name}" not found` }, { status: 404 });
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
