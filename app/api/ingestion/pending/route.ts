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

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function checkApiKey(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === process.env.INGESTION_API_KEY;
}

// POST /api/ingestion/pending
// Scope 1 non-metered only.
//
// Body (default — all Scope 1 coverage): { client_name, supplier_name }
//   Seeds PENDING for every Scope 1 facility group and standalone line for this pair.
//
// Body (group, optional targeting): { client_name, supplier_name, utility_name }
//   utility_name = NGERS category name on the group (e.g. "Transport Fuel").
//
// Body (line): { mode: "line", client_name, supplier_name, utility_name [, facility_name] }
//   utility_name = record input type name (e.g. "GREASE").
//   Omit facility_name when exactly one non_metered_lines row matches client+supplier+utility.
export async function POST(request: Request) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const body = await request.json();
    const { client_name, supplier_name, utility_name, mode, facility_name } = body;

    if (!client_name || !supplier_name) {
      return NextResponse.json(
        { error: 'client_name and supplier_name are required' },
        { status: 400 }
      );
    }

    const utilityTrimmed = typeof utility_name === 'string' ? utility_name.trim() : '';

    // ----- All Scope 1 coverage (client + supplier only) -----
    if (!utilityTrimmed) {
      const result = await seedAllScope1NonMeteredPending(supabase, client_name, supplier_name);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json({
        scope: 1,
        client_id: result.client_id,
        supplier_id: result.supplier_id,
        groups: result.groups,
        lines: result.lines,
        summary: result.summary,
      });
    }

    // ----- Standalone line (not in a facility group) -----
    if (mode === 'line') {
      const resolved = await resolveIngestionLine(
        supabase,
        client_name,
        typeof facility_name === 'string' ? facility_name.trim() : '',
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
          {
            error:
              'This endpoint only supports Scope 1 input types. Use a Scope 1 utility or omit utility_name to seed all Scope 1 coverage.',
          },
          { status: 400 }
        );
      }

      const { facilityId, facilityName, supplierId, categoryId } = resolved;
      const months = getCurrentFiscalYearMonthsThroughNow();
      const created = await seedIngestionPendingNonMeteredLineMonths(supabase, {
        facilityId,
        supplierId,
        inputTypeId: categoryId,
      });

      return NextResponse.json({
        mode: 'line',
        scope: 1,
        resolved: {
          facility_id: facilityId,
          facility_name: facilityName,
          supplier_id: supplierId,
          input_type_id: categoryId,
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

    let groupCategory: { id: string; scope: number };
    try {
      groupCategory = await findCategoryForIngestion(supabase, utilityTrimmed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    if (groupCategory.scope !== 1) {
      return NextResponse.json(
        {
          error:
            'This endpoint only supports Scope 1 NGERS categories for group pending. Use a Scope 1 category or omit utility_name to seed all Scope 1 coverage.',
        },
        { status: 400 }
      );
    }

    const { data: group } = await supabase
      .from('facility_groups')
      .select(
        `
        id,
        members:facility_group_members(
          line:non_metered_lines(facility_id, input_type_id)
        )
      `
      )
      .eq('client_id', client.id)
      .eq('supplier_id', supplier.id)
      .eq('category_id', groupCategory.id)
      .single();

    if (!group) {
      return NextResponse.json(
        {
          error: `No group configured for client "${client_name}", supplier "${supplier_name}", category "${utilityTrimmed}". Set it up in the tracker UI first.`,
        },
        { status: 404 }
      );
    }

    const members: GroupPendingMember[] = ((group.members ?? []) as any[])
      .map((m: any) => ({
        facility_id: m.line?.facility_id,
        input_type_id: m.line?.input_type_id,
      }))
      .filter((m): m is GroupPendingMember => !!m.facility_id && !!m.input_type_id);

    if (members.length === 0) {
      return NextResponse.json(
        { error: 'Group has no member facilities with utility types configured' },
        { status: 422 }
      );
    }

    const months = getCurrentFiscalYearMonthsThroughNow();
    const { created, skipped } = await seedNonMeteredFacilityGroupPending(supabase, supplier.id, members);

    return NextResponse.json({
      mode: 'group',
      scope: 1,
      created,
      skipped,
    });
  } catch (error) {
    console.error('Error in ingestion/pending:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
