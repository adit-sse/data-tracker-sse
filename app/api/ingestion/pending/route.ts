import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function checkApiKey(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === process.env.INGESTION_API_KEY;
}

// Returns all months from the start of the current fiscal year (July) up to
// and including the current month.
function getCurrentFiscalYearMonths(): Array<{ start: string; end: string }> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed; July = 6

  const fyStartYear = currentMonth >= 6 ? currentYear : currentYear - 1;
  const cursor = new Date(fyStartYear, 6, 1); // July 1
  const endMonth = new Date(currentYear, currentMonth, 1);

  const months: Array<{ start: string; end: string }> = [];
  while (cursor <= endMonth) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    months.push({
      start: `${y}-${String(m + 1).padStart(2, '0')}-01`,
      end: `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

// POST /api/ingestion/pending
// Called by the ingestion workflow when an invoice email is received.
// Marks all months in the current fiscal year as PENDING for every facility
// in the matching group, using each member's specific utility_category_id.
//
// Body: { client_name, supplier_name, utility_name }
// utility_name matches the group-level type (e.g. "Transport Fuels") — not the
// individual member sub-category.
export async function POST(request: Request) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { client_name, supplier_name, utility_name } = body;

    if (!client_name || !supplier_name || !utility_name) {
      return NextResponse.json(
        { error: 'client_name, supplier_name and utility_name are required' },
        { status: 400 }
      );
    }

    const [{ data: client }, { data: supplier }, { data: groupCategory }] = await Promise.all([
      supabase.from('clients').select('id').ilike('name', client_name).single(),
      supabase.from('suppliers').select('id').ilike('name', supplier_name).single(),
      supabase.from('utility_categories').select('id').ilike('name', utility_name).single(),
    ]);

    if (!client) return NextResponse.json({ error: `Client "${client_name}" not found` }, { status: 404 });
    if (!supplier) return NextResponse.json({ error: `Supplier "${supplier_name}" not found` }, { status: 404 });
    if (!groupCategory) return NextResponse.json({ error: `Utility type "${utility_name}" not found` }, { status: 404 });

    // Find the group by its top-level type (utility_category_id on the group row)
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
          error: `No group configured for client "${client_name}", supplier "${supplier_name}", utility type "${utility_name}". Set it up in the tracker UI first.`,
        },
        { status: 404 }
      );
    }

    type MemberRow = { facility_id: string; utility_category_id: string | null };
    const members: MemberRow[] = (group.members ?? []).filter(
      (m: MemberRow) => m.utility_category_id
    );

    if (members.length === 0) {
      return NextResponse.json(
        { error: 'Group has no member facilities with utility types configured' },
        { status: 422 }
      );
    }

    const allFacilityIds = members.map((m) => m.facility_id);
    const months = getCurrentFiscalYearMonths();
    const periodStarts = months.map((m) => m.start);

    // For each member, fetch existing records under its specific category (any status blocks PENDING)
    // and any confirmed records from this supplier (any category) — those are already green.
    const [{ data: existingExact }, { data: existingGreen }] = await Promise.all([
      supabase
        .from('non_metered_records')
        .select('facility_id, utility_category_id, period_start_date')
        .in('facility_id', allFacilityIds)
        .eq('supplier_id', supplier.id)
        .in('period_start_date', periodStarts),
      supabase
        .from('non_metered_records')
        .select('facility_id, period_start_date')
        .in('facility_id', allFacilityIds)
        .eq('supplier_id', supplier.id)
        .in('period_start_date', periodStarts)
        .in('status', ['IMPORTED', 'MANUAL', 'CONFIRMED']),
    ]);

    // facility__period => set of category ids that already have records
    const existingByCategoryKey = new Set<string>(
      (existingExact ?? []).map(
        (r: { facility_id: string; utility_category_id: string; period_start_date: string }) =>
          `${r.facility_id}__${r.utility_category_id}__${r.period_start_date}`
      )
    );

    // facility__period => already has a green record from this supplier (any category)
    const greenSet = new Set<string>(
      (existingGreen ?? []).map(
        (r: { facility_id: string; period_start_date: string }) =>
          `${r.facility_id}__${r.period_start_date}`
      )
    );

    const toInsert = [];
    for (const member of members) {
      const catId = member.utility_category_id!;
      for (const month of months) {
        const catKey = `${member.facility_id}__${catId}__${month.start}`;
        const greenKey = `${member.facility_id}__${month.start}`;
        if (!existingByCategoryKey.has(catKey) && !greenSet.has(greenKey)) {
          toInsert.push({
            facility_id: member.facility_id,
            supplier_id: supplier.id,
            utility_category_id: catId,
            period_start_date: month.start,
            period_end_date: month.end,
            status: 'PENDING',
          });
        }
      }
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('non_metered_records')
        .insert(toInsert);
      if (insertError) throw insertError;
    }

    return NextResponse.json({
      created: toInsert.length,
      skipped: members.length * months.length - toInsert.length,
    });
  } catch (error) {
    console.error('Error in ingestion/pending:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
