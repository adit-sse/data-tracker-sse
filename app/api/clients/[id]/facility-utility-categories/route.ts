import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/clients/[id]/facility-utility-categories?scope=1
// Returns: { [facilityId]: { id, name, scope }[] }
// Lists the distinct utility categories that already have non_metered_records
// for each of this client's facilities, filtered to the requested scope.
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope') ? parseInt(searchParams.get('scope')!, 10) : null;

    // Get all facility IDs for this client
    const { data: facilities, error: facilitiesError } = await supabase
      .from('facilities')
      .select('id')
      .eq('client_id', params.id);

    if (facilitiesError) throw facilitiesError;
    const facilityIds = (facilities ?? []).map((f: any) => f.id);

    if (facilityIds.length === 0) {
      return NextResponse.json({});
    }

    // Fetch distinct (facility_id, utility_category_id) pairs from non_metered_records,
    // joining utility_categories to filter by scope and get the name.
    let query = supabase
      .from('non_metered_records')
      .select(`
        facility_id,
        supplier_id,
        supplier:suppliers(id, name),
        utility_category:utility_categories!inner(id, name, scope)
      `)
      .in('facility_id', facilityIds);

    if (scope !== null) {
      query = query.eq('utility_categories.scope', scope);
    }

    const { data: records, error: recordsError } = await query;
    if (recordsError) throw recordsError;

    // Deduplicate by (facility_id, utility_category_id, supplier_id) so each unique
    // category+supplier combo gets its own entry. The supplier name is shown in the
    // dropdown label so the user can pick the right one when the same utility type
    // exists under multiple suppliers.
    const result: Record<string, { id: string; name: string; scope: number; supplierId: string | null; supplierName: string | null }[]> = {};
    const seen = new Set<string>();

    for (const rec of records ?? []) {
      const fid = String(rec.facility_id);
      const cat = (rec as any).utility_category;
      const sup = (rec as any).supplier;
      if (!cat) continue;
      const sid = rec.supplier_id ? String(rec.supplier_id) : 'null';
      const dedupKey = `${fid}__${cat.id}__${sid}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      if (!result[fid]) result[fid] = [];
      result[fid].push({
        id: String(cat.id),
        name: cat.name,
        scope: cat.scope,
        supplierId: rec.supplier_id ? String(rec.supplier_id) : null,
        supplierName: sup?.name ?? null,
      });
    }

    // Sort each facility's options by category name, then supplier name
    for (const fid of Object.keys(result)) {
      result[fid].sort((a, b) => {
        const n = a.name.localeCompare(b.name);
        if (n !== 0) return n;
        return (a.supplierName ?? '').localeCompare(b.supplierName ?? '');
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching facility utility categories:', error);
    return NextResponse.json({ error: 'Failed to fetch facility utility categories' }, { status: 500 });
  }
}
