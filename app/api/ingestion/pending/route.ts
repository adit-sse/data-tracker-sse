import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { resolveIngestionLine } from '@/lib/ingestion-line';
import { findOrCreateUtilityCategoryForIngestion } from '@/lib/ingestion-utility-category';
import {
  getCurrentFiscalYearMonthsThroughNow,
  seedIngestionPendingNonMeteredLineMonths,
} from '@/lib/non-metered-pending-seed';
import { upsertNonMeteredLines } from '@/lib/non-metered-lines';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function checkApiKey(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === process.env.INGESTION_API_KEY;
}

// POST /api/ingestion/pending
// Called by the ingestion workflow when an invoice email is received.
// Marks all months in the current fiscal year as PENDING for every facility
// in the matching group, using each member's specific utility_category_id.
//
// Body (group): { client_name, supplier_name, utility_name }
//   utility_name = group-level type (e.g. "Transport Fuels").
// Body (line): { mode: "line", client_name, supplier_name, utility_name [, facility_name] }
//   utility_name = the record category (e.g. "GREASE"). No facility group required.
//   facility_name optional for Scope 3 (uses "(Client-wide)"); required for Scope 1 / 2.
export async function POST(request: Request) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const body = await request.json();
    const { client_name, supplier_name, utility_name, mode, facility_name } = body;

    if (!client_name || !supplier_name || !utility_name) {
      return NextResponse.json(
        { error: 'client_name, supplier_name and utility_name are required' },
        { status: 400 }
      );
    }

    // ----- Standalone line (not in a facility group) -----
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

      const { facilityId, facilityName, supplierId, categoryId } = resolved;
      const months = getCurrentFiscalYearMonthsThroughNow();
      const created = await seedIngestionPendingNonMeteredLineMonths(supabase, {
        facilityId,
        supplierId,
        categoryId,
      });

      return NextResponse.json({
        mode: 'line',
        /** Only this facility receives PENDING rows (never other sites). */
        resolved: {
          facility_id: facilityId,
          facility_name: facilityName,
          supplier_id: supplierId,
          utility_category_id: categoryId,
        },
        created,
        skipped: months.length - created,
      });
    }

    // ----- Facility group -----
    const [{ data: client }, { data: supplier }] = await Promise.all([
      supabase.from('clients').select('id').ilike('name', client_name).single(),
      supabase.from('suppliers').select('id').ilike('name', supplier_name).single(),
    ]);

    if (!client) return NextResponse.json({ error: `Client "${client_name}" not found` }, { status: 404 });
    if (!supplier) return NextResponse.json({ error: `Supplier "${supplier_name}" not found` }, { status: 404 });

    let groupCategory: { id: string };
    try {
      groupCategory = await findOrCreateUtilityCategoryForIngestion(supabase, utility_name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 400 });
    }

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
    const months = getCurrentFiscalYearMonthsThroughNow();
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
        .in('status', ['IMPORTED', 'MANUAL', 'CONFIRMED', 'DEACTIVATED']),
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

    // Register lines for all group members so the grid shows them even before records exist.
    await upsertNonMeteredLines(
      supabase,
      members.map((m) => ({
        facilityId: m.facility_id,
        supplierId: supplier.id,
        categoryId: m.utility_category_id!,
      }))
    );

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
