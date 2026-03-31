import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { resolveIngestionLine } from '@/lib/ingestion-line';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function checkApiKey(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === process.env.INGESTION_API_KEY;
}

/** Same as confirm route: "DD/MM/YYYY - DD/MM/YYYY" → { start, end } ISO */
function parseDateRange(dateRange: string): { start: string; end: string } | null {
  const parts = dateRange.split(' - ');
  if (parts.length !== 2) return null;
  const parseDate = (d: string): string | null => {
    const match = d.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    return `${match[3]}-${match[2]}-${match[1]}`;
  };
  const start = parseDate(parts[0]);
  const end = parseDate(parts[1]);
  if (!start || !end) return null;
  return { start, end };
}

/** First day of the calendar month containing `isoDate` (YYYY-MM-DD) */
function monthStart(isoDate: string): string {
  const [y, m] = isoDate.split('-');
  return `${y}-${m}-01`;
}

// POST /api/ingestion/error
// When ingestion fails for a period, mark PENDING rows as ERROR.
// Group body: { client_name, supplier_name, utility_name, date_range }
// Line body: { mode: "line", client_name, supplier_name, utility_name, date_range [, facility_name] }
//   facility_name optional for Scope 3 (same rules as /ingestion/pending line mode).
// date_range: "DD/MM/YYYY - DD/MM/YYYY" (month is taken from the start date)
export async function POST(request: Request) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const body = await request.json();
    const { client_name, supplier_name, utility_name, date_range, mode, facility_name } = body;

    if (!client_name || !supplier_name || !utility_name || !date_range) {
      return NextResponse.json(
        { error: 'client_name, supplier_name, utility_name, and date_range are required' },
        { status: 400 }
      );
    }

    const parsed = parseDateRange(String(date_range));
    if (!parsed) {
      return NextResponse.json(
        { error: 'date_range must be "DD/MM/YYYY - DD/MM/YYYY"' },
        { status: 400 }
      );
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
        return NextResponse.json({ error: resolved.error }, { status: resolved.status });
      }

      const { facilityId, supplierId, categoryId } = resolved;

      const { data: pendingRows, error: fetchError } = await supabase
        .from('non_metered_records')
        .select('id')
        .eq('facility_id', facilityId)
        .eq('supplier_id', supplierId)
        .eq('utility_category_id', categoryId)
        .eq('period_start_date', periodStart)
        .eq('status', 'PENDING');

      if (fetchError) throw fetchError;

      const ids = (pendingRows ?? []).map((r: { id: string }) => r.id);
      if (ids.length === 0) {
        return NextResponse.json({
          mode: 'line',
          updated: 0,
          message: `No PENDING records for ${periodStart}. Run pending (line) first, or this month was already resolved.`,
        });
      }

      const { error: updateError } = await supabase
        .from('non_metered_records')
        .update({ status: 'ERROR' })
        .in('id', ids);

      if (updateError) throw updateError;

      return NextResponse.json({
        mode: 'line',
        updated: ids.length,
        period_start_date: periodStart,
      });
    }

    // ----- Facility group -----
    const [{ data: client }, { data: supplier }, { data: groupCategory }] = await Promise.all([
      supabase.from('clients').select('id').ilike('name', client_name).single(),
      supabase.from('suppliers').select('id').ilike('name', supplier_name).single(),
      supabase.from('utility_categories').select('id').ilike('name', utility_name).single(),
    ]);

    if (!client) return NextResponse.json({ error: `Client "${client_name}" not found` }, { status: 404 });
    if (!supplier) return NextResponse.json({ error: `Supplier "${supplier_name}" not found` }, { status: 404 });
    if (!groupCategory) {
      return NextResponse.json({ error: `Utility type "${utility_name}" not found` }, { status: 404 });
    }

    const { data: group } = await supabase
      .from('facility_groups')
      .select(`
        id,
        members:facility_group_members(
          facility_id,
          utility_category_id
        )
      `)
      .eq('client_id', client.id)
      .eq('supplier_id', supplier.id)
      .eq('utility_category_id', groupCategory.id)
      .single();

    if (!group) {
      return NextResponse.json(
        {
          error: `No group configured for client "${client_name}", supplier "${supplier_name}", utility type "${utility_name}".`,
        },
        { status: 404 }
      );
    }

    type MemberRow = { facility_id: string; utility_category_id: string | null };
    const members: MemberRow[] = (group.members ?? []).filter(
      (m: MemberRow) => m.utility_category_id
    );

    if (members.length === 0) {
      return NextResponse.json({ error: 'Group has no members with utility types' }, { status: 422 });
    }

    const facilityIds = members.map((m) => m.facility_id);
    const categoryIds = Array.from(new Set(members.map((m) => m.utility_category_id!)));

    const { data: pendingRows, error: fetchError } = await supabase
      .from('non_metered_records')
      .select('id')
      .in('facility_id', facilityIds)
      .eq('supplier_id', supplier.id)
      .in('utility_category_id', categoryIds)
      .eq('period_start_date', periodStart)
      .eq('status', 'PENDING');

    if (fetchError) throw fetchError;

    const ids = (pendingRows ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) {
      return NextResponse.json({
        updated: 0,
        message: `No PENDING records for ${periodStart}. Run /api/ingestion/pending first, or this month was already confirmed.`,
      });
    }

    const { error: updateError } = await supabase
      .from('non_metered_records')
      .update({ status: 'ERROR' })
      .in('id', ids);

    if (updateError) throw updateError;

    return NextResponse.json({
      mode: 'group',
      updated: ids.length,
      period_start_date: periodStart,
    });
  } catch (error) {
    console.error('Error in ingestion/error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
