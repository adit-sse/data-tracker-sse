import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { checkApiKey } from '@/lib/ingestion-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/ingestion/mixed-scope?client_name=...&supplier_name=...
 *
 * Same auth as other ingestion routes (Bearer INGESTION_API_KEY).
 * Names match case-insensitively.
 *
 * Checks whether a supplier handles both Scope 1 and Scope 2 utilities
 * for the given client. Use this before calling POST /api/ingestion/pending
 * to decide whether to skip pending and go straight to confirm instead.
 *
 * Scope 1 is detected from:
 *   - meters rows whose input_type has scope = 1
 *   - non_metered_lines rows whose input_type has scope = 1
 * Scope 2 is detected from:
 *   - meters rows whose input_type has scope = 2
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

    if (facilityIds.length === 0) {
      return NextResponse.json(
        {
          error: `No meters or non-metered lines configured for client "${client_name}" and supplier "${supplier_name}". Check that the client+supplier pairing is set up correctly before running ingestion.`,
        },
        { status: 404 }
      );
    }

    // Fetch all meters for this client+supplier, with their input type scope
    const { data: meterRows, error: meterErr } = await supabase
      .from('meters')
      .select('input_type_id, input_types(name, scope)')
      .eq('supplier_id', supplier.id)
      .in('facility_id', facilityIds);

    if (meterErr) throw meterErr;

    // Fetch all non-metered lines for this client+supplier, with their input type scope
    const { data: lineRows, error: lineErr } = await supabase
      .from('non_metered_lines')
      .select('input_type_id, input_types(name, scope)')
      .eq('supplier_id', supplier.id)
      .in('facility_id', facilityIds);

    if (lineErr) throw lineErr;

    type InputTypeEmbed =
      | { name: string; scope: number }
      | { name: string; scope: number }[]
      | null;

    function resolveInputType(raw: InputTypeEmbed): { name: string; scope: number } | null {
      if (!raw) return null;
      return Array.isArray(raw) ? (raw[0] ?? null) : raw;
    }

    const scope1Names = new Set<string>();
    const scope2Names = new Set<string>();
    const nullScopeNames = new Set<string>();

    for (const row of meterRows ?? []) {
      const it = resolveInputType((row as { input_types: InputTypeEmbed }).input_types);
      if (!it) continue;
      if (it.scope === 1) scope1Names.add(it.name);
      else if (it.scope === 2) scope2Names.add(it.name);
      else nullScopeNames.add(it.name);
    }

    for (const row of lineRows ?? []) {
      const it = resolveInputType((row as { input_types: InputTypeEmbed }).input_types);
      if (!it) continue;
      if (it.scope === 1) scope1Names.add(it.name);
      else if (it.scope !== 2) nullScopeNames.add(it.name);
    }

    const has_scope1 = scope1Names.size > 0;
    const has_scope2 = scope2Names.size > 0;
    const totalRows = (meterRows?.length ?? 0) + (lineRows?.length ?? 0);

    if (totalRows === 0) {
      return NextResponse.json(
        {
          error: `No meters or non-metered lines configured for client "${client_name}" and supplier "${supplier_name}". Check that the client+supplier pairing is set up correctly before running ingestion.`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      client_id: client.id,
      client_name: client.name,
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      has_scope1,
      has_scope2,
      has_mixed_scopes: has_scope1 && has_scope2,
      scope1_input_types: Array.from(scope1Names).sort(),
      scope2_input_types: Array.from(scope2Names).sort(),
      ...(nullScopeNames.size > 0 && {
        warning: `${nullScopeNames.size} input type(s) have no scope set and were excluded from scope detection: ${Array.from(nullScopeNames).sort().join(', ')}. Fix these in Manage Input Types.`,
      }),
    });
  } catch (e) {
    console.error('GET /api/ingestion/mixed-scope:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
