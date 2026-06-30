import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { resolveIngestionLine } from '@/lib/ingestion-line';
import { logIngestionErrorReport } from '@/lib/ingestion-events';
import { checkApiKey } from '@/lib/ingestion-auth';
import { parseNgersDateRange } from '@/lib/ingestion-dates';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** First day of the calendar month containing `isoDate` (YYYY-MM-DD) */
function monthStart(isoDate: string): string {
  const [y, m] = isoDate.split('-');
  return `${y}-${m}-01`;
}

// POST /api/ingestion/error
// When ingestion fails for a period, mark PENDING rows as ERROR.
// Group body: { client_name, supplier_name, utility_name, date_range }
// Line body: { mode: "line", client_name, supplier_name, utility_name, date_range [, facility_name] }
//   Same facility_name rules as /ingestion/pending line mode.
// date_range: "DD/MM/YYYY - DD/MM/YYYY" (month is taken from the start date)
type HandleErrorResult = { response: NextResponse; resolvedGroupId: number | null };

async function handleError(supabase: SupabaseClient, body: Record<string, unknown>): Promise<HandleErrorResult> {
  const ok = (response: NextResponse, resolvedGroupId: number | null = null): HandleErrorResult =>
    ({ response, resolvedGroupId });

  try {
    const { client_name, supplier_name, utility_name, date_range, mode, facility_name } = body as {
      client_name?: string;
      supplier_name?: string;
      utility_name?: string;
      date_range?: string;
      mode?: string;
      facility_name?: string;
    };

    if (!client_name || !supplier_name || !utility_name || !date_range) {
      return ok(NextResponse.json(
        { error: 'client_name, supplier_name, utility_name, and date_range are required' },
        { status: 400 }
      ));
    }

    const parsed = parseNgersDateRange(String(date_range));
    if (!parsed) {
      return ok(NextResponse.json(
        { error: 'date_range must be "DD/MM/YYYY - DD/MM/YYYY"' },
        { status: 400 }
      ));
    }

    const periodStart = monthStart(parsed.start);

    // ----- Standalone line -----
    if (mode === 'line') {
      const resolved = await resolveIngestionLine(
        supabase,
        client_name,
        typeof facility_name === 'string' ? facility_name.trim() : '',
        supplier_name,
        utility_name
      );
      if (!resolved.ok) {
        return ok(NextResponse.json({ error: resolved.error }, { status: resolved.status }));
      }

      const { facilityId, supplierId, categoryId } = resolved;

      // Check whether this line belongs to a facility group so we can tag the event.
      const { data: nmLine } = await supabase
        .from('non_metered_lines')
        .select('id, facility_group_members(group_id)')
        .eq('facility_id', facilityId)
        .eq('supplier_id', supplierId)
        .eq('input_type_id', categoryId)
        .maybeSingle();
      const lineGroupId =
        (nmLine as { facility_group_members?: { group_id: number }[] } | null)
          ?.facility_group_members?.[0]?.group_id ?? null;

      const { data: pendingRows, error: fetchError } = await supabase
        .from('non_metered_records')
        .select('id')
        .eq('facility_id', facilityId)
        .eq('supplier_id', supplierId)
        .eq('input_type_id', categoryId)
        .eq('period_start_date', periodStart)
        .eq('status', 'PENDING');

      if (fetchError) throw fetchError;

      const ids = (pendingRows ?? []).map((r: { id: string }) => r.id);
      if (ids.length === 0) {
        return ok(NextResponse.json({
          mode: 'line',
          updated: 0,
          message: `No PENDING records for ${periodStart}. Run pending (line) first, or this month was already resolved.`,
        }), lineGroupId);
      }

      const { error: updateError } = await supabase
        .from('non_metered_records')
        .update({ status: 'ERROR' })
        .in('id', ids);

      if (updateError) throw updateError;

      return ok(NextResponse.json({
        mode: 'line',
        updated: ids.length,
        period_start_date: periodStart,
      }), lineGroupId);
    }

    // ----- Facility group -----
    const [{ data: client }, { data: supplierRaw }, { data: groupCategory }] = await Promise.all([
      supabase.from('clients').select('id').ilike('name', client_name).single(),
      supabase.rpc('get_supplier_by_name', { input_name: supplier_name }).single(),
      supabase.from('categories').select('id').ilike('name', utility_name).single(),
    ]);
    const supplier = supplierRaw as { id: string; name: string } | null;

    if (!client) return ok(NextResponse.json({ error: `Client "${client_name}" not found` }, { status: 404 }));
    if (!supplier) return ok(NextResponse.json({ error: `Supplier "${supplier_name}" not found` }, { status: 404 }));
    if (!groupCategory) {
      return ok(NextResponse.json({ error: `Category "${utility_name}" not found` }, { status: 404 }));
    }

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
      return ok(NextResponse.json(
        {
          error: `No group configured for client "${client_name}", supplier "${supplier_name}", utility type "${utility_name}".`,
        },
        { status: 404 }
      ));
    }

    type MemberRow = { facility_id: string; input_type_id: string };
    // Flatten line data into the shape the rest of this handler expects
    const members: MemberRow[] = ((group.members ?? []) as any[])
      .map((m: any) => ({
        facility_id: m.line?.facility_id,
        input_type_id: m.line?.input_type_id,
      }))
      .filter((m): m is MemberRow => !!m.facility_id && !!m.input_type_id);

    if (members.length === 0) {
      return ok(NextResponse.json({ error: 'Group has no members with input types' }, { status: 422 }), group.id);
    }

    const facilityIds = members.map((m) => m.facility_id);
    const categoryIds = Array.from(new Set(members.map((m) => m.input_type_id!)));

    const { data: pendingRows, error: fetchError } = await supabase
      .from('non_metered_records')
      .select('id')
      .in('facility_id', facilityIds)
      .eq('supplier_id', supplier.id)
      .in('input_type_id', categoryIds)
      .eq('period_start_date', periodStart)
      .eq('status', 'PENDING');

    if (fetchError) throw fetchError;

    const ids = (pendingRows ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) {
      return ok(NextResponse.json({
        updated: 0,
        message: `No PENDING records for ${periodStart}. Run /api/ingestion/pending first, or this month was already confirmed.`,
      }), group.id);
    }

    const { error: updateError } = await supabase
      .from('non_metered_records')
      .update({ status: 'ERROR' })
      .in('id', ids);

    if (updateError) throw updateError;

    return ok(NextResponse.json({
      mode: 'group',
      updated: ids.length,
      period_start_date: periodStart,
    }), group.id);
  } catch (error) {
    console.error('Error in ingestion/error:', error);
    return ok(NextResponse.json({ error: 'Internal server error' }, { status: 500 }));
  }
}

// POST body may include an optional `reason` describing why the upstream ingestion failed;
// it is recorded on the ingestion_events log (the record itself is only flipped to ERROR).
export async function POST(request: Request) {
  const startedAt = Date.now();
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createSupabaseServiceRoleClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    const res = NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    await logIngestionErrorReport(supabase, {
      endpoint: 'error',
      scopeKind: 'non_metered',
      groupId: null,
      request: null,
      response: res,
      startedAt,
    });
    return res;
  }

  const { response: res, resolvedGroupId } = await handleError(supabase, body);
  await logIngestionErrorReport(supabase, {
    endpoint: 'error',
    scopeKind: typeof body?.mode === 'string' && body.mode === 'line' ? 'line' : 'group',
    groupId: resolvedGroupId,
    request: body,
    response: res,
    startedAt,
  });
  return res;
}
