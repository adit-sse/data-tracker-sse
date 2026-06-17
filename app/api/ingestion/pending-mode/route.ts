import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { checkApiKey } from '@/lib/ingestion-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type GroupRow = {
  id: string;
  name: string;
  category_id: string | null;
  /** Supabase may type embeds as a single object or array depending on schema inference */
  category: { id: string; name: string } | { id: string; name: string }[] | null;
  members: { non_metered_line_id: string | null }[] | null;
};

function firstCategory(
  category: GroupRow['category']
): { id: string; name: string } | null {
  if (!category) return null;
  return Array.isArray(category) ? category[0] ?? null : category;
}

/**
 * GET /api/ingestion/pending-mode?client_name=...&supplier_name=...
 *
 * Same auth as other ingestion routes (Bearer INGESTION_API_KEY).
 * Names match case-insensitively, like POST /api/ingestion/pending.
 *
 * Helps choose group pending (default body) vs line pending (mode: "line").
 */
export async function GET(request: Request) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const client_name = searchParams.get('client_name')?.trim();
  const supplier_name = searchParams.get('supplier_name')?.trim();

  if (!client_name || !supplier_name) {
    return NextResponse.json(
      { error: 'client_name and supplier_name query parameters are required' },
      { status: 400 }
    );
  }

  try {
    const supabase = createSupabaseServiceRoleClient();

    const [{ data: client }, { data: supplier }] = await Promise.all([
      supabase.from('clients').select('id, name').ilike('name', client_name).single(),
      supabase.from('suppliers').select('id, name').ilike('name', supplier_name).single(),
    ]);

    if (!client) {
      return NextResponse.json({ error: `Client "${client_name}" not found` }, { status: 404 });
    }
    if (!supplier) {
      return NextResponse.json({ error: `Supplier "${supplier_name}" not found` }, { status: 404 });
    }

    const { data: facilities, error: facErr } = await supabase
      .from('facilities')
      .select('id')
      .eq('client_id', client.id);

    if (facErr) throw facErr;

    const facilityIds = (facilities ?? []).map((f: { id: string }) => f.id);

    const { data: groupRows, error: groupErr } = await supabase
      .from('facility_groups')
      .select(
        `
        id,
        name,
        category_id,
        category:categories(id, name),
        members:facility_group_members(non_metered_line_id)
      `
      )
      .eq('client_id', client.id)
      .eq('supplier_id', supplier.id);

    if (groupErr) throw groupErr;

    const groups = (groupRows ?? []) as GroupRow[];
    const groupedLineIds = new Set<string>();
    const facility_groups = groups.map((g) => {
      const memberRows = g.members ?? [];
      for (const m of memberRows) {
        if (m.non_metered_line_id) groupedLineIds.add(String(m.non_metered_line_id));
      }
      const member_count = memberRows.filter((m) => m.non_metered_line_id).length;
      const cat = firstCategory(g.category);
      return {
        id: g.id,
        name: g.name,
        category_id: g.category_id,
        category_name: cat?.name ?? null,
        member_count,
        ready_for_group_pending: member_count > 0 && g.category_id != null,
      };
    });

    let standalone_non_metered_line_count = 0;

    if (facilityIds.length > 0) {
      const { data: lines, error: linesErr } = await supabase
        .from('non_metered_lines')
        .select('id')
        .eq('supplier_id', supplier.id)
        .in('facility_id', facilityIds);

      if (linesErr) throw linesErr;

      standalone_non_metered_line_count = (lines ?? []).filter(
        (row: { id: string }) => !groupedLineIds.has(String(row.id))
      ).length;
    }

    const has_ready_group = facility_groups.some((g) => g.ready_for_group_pending);
    const has_standalone = standalone_non_metered_line_count > 0;

    let pending_mode: 'group' | 'line' | 'mixed' | 'none';
    if (has_ready_group && has_standalone) pending_mode = 'mixed';
    else if (has_ready_group) pending_mode = 'group';
    else if (has_standalone) pending_mode = 'line';
    else pending_mode = 'none';

    return NextResponse.json({
      client_id: client.id,
      client_name: client.name,
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      pending_mode,
      facility_groups,
      standalone_non_metered_line_count,
      /** POST /api/ingestion/pending without mode: "line" */
      use_group_pending_body: pending_mode === 'group' || pending_mode === 'mixed',
      /** POST /api/ingestion/pending with mode: "line" (facility_name optional when exactly one line row matches) */
      use_line_pending_body: pending_mode === 'line' || pending_mode === 'mixed',
    });
  } catch (e) {
    console.error('GET /api/ingestion/pending-mode:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
