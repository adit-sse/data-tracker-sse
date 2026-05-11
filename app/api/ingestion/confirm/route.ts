import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { resolveIngestionLine } from '@/lib/ingestion-line';
import { findInputTypeForIngestion } from '@/lib/ingestion-utility-category';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface NGERSRow {
  Company?: string;
  Facility?: string;
  Provider?: string;
  Category?: string;
  'Sub-Category'?: string;
  'Input Type'?: string;
  'Date Range'?: string;
  [key: string]: unknown;
}

interface GroupMember {
  line: {
    facility_id: string | number;
    input_type_id: string | null;
    facility: { id: string | number; name: string } | null;
  } | null;
}

type ConfirmError = { ok: false; error: string; status: number };
type LineConfirmResult = { ok: true; confirmed: number } | ConfirmError;

function checkApiKey(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === process.env.INGESTION_API_KEY;
}

// Parses "DD/MM/YYYY - DD/MM/YYYY" into { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }
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

/**
 * Standalone line: each row's Input Type = record utility (e.g. kL), Facility = site name.
 * Category is optional — not used for targeting (electricity rows may omit it).
 * Only the submitted facility+period combos are updated to CONFIRMED.
 * No deletions; no INFERRED_EMPTY. Call POST /api/ingestion/inferred-empty to finalise.
 */
async function processLineConfirm(
  supabase: SupabaseClient,
  rows: NGERSRow[]
): Promise<LineConfirmResult> {
  let totalConfirmed = 0;

  const groupedRows = new Map<string, NGERSRow[]>();
  for (const row of rows) {
    const facKey = (row.Facility ?? '').trim();
    const inputTypeKey = (row['Input Type'] ?? '').trim();
    const key = `${row.Company}__${row.Provider}__${inputTypeKey}__${facKey}`;
    if (!groupedRows.has(key)) groupedRows.set(key, []);
    groupedRows.get(key)!.push(row);
  }

  for (const [, lineRows] of Array.from(groupedRows.entries())) {
    const { Company, Provider, Facility } = lineRows[0];
    const InputType = (lineRows[0]['Input Type'] ?? '').trim();
    if (!Company || !Provider || !InputType) {
      return { ok: false, error: 'Row missing Company, Provider, or Input Type', status: 400 };
    }

    const resolved = await resolveIngestionLine(
      supabase,
      Company,
      (Facility ?? '').trim(),
      Provider,
      InputType
    );
    if (!resolved.ok) {
      return { ok: false, error: resolved.error, status: resolved.status };
    }

    const { facilityId, supplierId, categoryId } = resolved;

    for (const row of lineRows) {
      if (!row['Date Range']) {
        return { ok: false, error: 'Row is missing Date Range', status: 422 };
      }
      const parsed = parseDateRange(row['Date Range']);
      if (!parsed) {
        return {
          ok: false,
          error: `Could not parse Date Range "${row['Date Range']}" — expected format: "DD/MM/YYYY - DD/MM/YYYY"`,
          status: 422,
        };
      }

      const { data: existing } = await supabase
        .from('non_metered_records')
        .select('id')
        .eq('facility_id', facilityId)
        .eq('supplier_id', supplierId)
        .eq('input_type_id', categoryId)
        .eq('period_start_date', parsed.start)
        .eq('status', 'PENDING')
        .maybeSingle();

      if (existing) {
        const { error: updErr } = await supabase
          .from('non_metered_records')
          .update({ status: 'CONFIRMED' })
          .eq('id', existing.id);
        if (updErr) throw new Error(updErr.message);
      } else {
        const { error: upErr } = await supabase.from('non_metered_records').upsert(
          {
            facility_id: facilityId,
            supplier_id: supplierId,
            input_type_id: categoryId,
            period_start_date: parsed.start,
            period_end_date: parsed.end,
            status: 'CONFIRMED',
          },
          {
            onConflict: 'facility_id,supplier_id,input_type_id,period_start_date,period_end_date',
            ignoreDuplicates: false,
          }
        );
        if (upErr) throw new Error(upErr.message);
      }
      totalConfirmed++;
    }
  }

  return { ok: true, confirmed: totalConfirmed };
}

// POST /api/ingestion/confirm
//
// Group mode: plain JSON array of NGERS rows.
//   Category (required) = NGERS reporting category on the facility_group.
//   Input Type (required) = filters which group members to process.
//   Only the submitted facility+period combos are CONFIRMED. No deletions, no inference.
//   Call POST /api/ingestion/inferred-empty after all invoices are submitted.
//
// Line mode: { "mode": "line", "rows": [ ... ] }
//   Input Type (required) = utility input type to target (e.g. "kL", "Electricity").
//   Category (optional) — electricity rows may omit it.
//   Facility = site name. No deletions, no INFERRED_EMPTY siblings.
//
// All lookup failures (client, supplier, category, input type, facility, date range) return
// a hard 4xx — nothing is silently skipped.
export async function POST(request: Request) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const raw = await request.json();
    let rows: NGERSRow[];
    let lineMode = false;

    if (Array.isArray(raw)) {
      rows = raw;
    } else if (raw && typeof raw === 'object' && raw.mode === 'line' && Array.isArray(raw.rows)) {
      rows = raw.rows;
      lineMode = true;
    } else {
      return NextResponse.json(
        {
          error:
            'Request body must be a non-empty array of NGERS rows, or { "mode": "line", "rows": [...] }',
        },
        { status: 400 }
      );
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'rows must be non-empty' }, { status: 400 });
    }

    if (lineMode) {
      const result = await processLineConfirm(supabase, rows);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json({ mode: 'line', confirmed: result.confirmed });
    }

    let totalConfirmed = 0;

    // Group rows by (Company, Provider, Category, InputType).
    const groupedRows = new Map<string, NGERSRow[]>();
    for (const row of rows) {
      const catKey = (row.Category ?? '').trim();
      const inputTypeKey = (row['Input Type'] ?? '').trim();
      const key = `${row.Company}__${row.Provider}__${catKey}__${inputTypeKey}`;
      if (!groupedRows.has(key)) groupedRows.set(key, []);
      groupedRows.get(key)!.push(row);
    }

    for (const [, groupRows] of Array.from(groupedRows.entries())) {
      const { Company, Provider, Category } = groupRows[0];
      const InputType = (groupRows[0]['Input Type'] ?? '').trim();
      if (!Company || !Provider || !Category || !InputType) {
        return NextResponse.json(
          { error: 'Row missing Company, Provider, Category, or Input Type' },
          { status: 400 }
        );
      }

      const [{ data: client }, { data: supplier }, { data: groupCategory }] = await Promise.all([
        supabase.from('clients').select('id').ilike('name', Company).single(),
        supabase.from('suppliers').select('id').ilike('name', Provider).single(),
        supabase.from('categories').select('id').ilike('name', Category).single(),
      ]);

      if (!client) {
        return NextResponse.json({ error: `Client "${Company}" not found` }, { status: 404 });
      }
      if (!supplier) {
        return NextResponse.json({ error: `Supplier "${Provider}" not found` }, { status: 404 });
      }
      if (!groupCategory) {
        return NextResponse.json({ error: `Category "${Category}" not found` }, { status: 404 });
      }

      let targetInputTypeId: string;
      try {
        const resolved = await findInputTypeForIngestion(supabase, InputType);
        targetInputTypeId = resolved.id;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 400 });
      }

      const { data: group } = await supabase
        .from('facility_groups')
        .select(`
          id,
          members:facility_group_members(
            line:non_metered_lines(
              facility_id,
              input_type_id,
              facility:facilities(id, name)
            )
          )
        `)
        .eq('client_id', client.id)
        .eq('supplier_id', supplier.id)
        .eq('category_id', groupCategory.id)
        .single();

      if (!group) {
        return NextResponse.json(
          {
            error: `No facility group configured for "${Company}" / "${Provider}" / "${Category}"`,
          },
          { status: 404 }
        );
      }

      const members = (group.members ?? []) as unknown as GroupMember[];

      // Build name → id map for members matching the target input type.
      const facilityNameToId = new Map<string, string>();
      const allMemberIds: string[] = [];

      for (const member of members) {
        const line = member.line;
        if (!line || !line.input_type_id) continue;
        if (line.input_type_id !== targetInputTypeId) continue;
        const fid = String(line.facility_id);
        const fname = line.facility?.name;
        if (fname) facilityNameToId.set(fname.toLowerCase(), fid);
        allMemberIds.push(fid);
      }

      if (allMemberIds.length === 0) {
        return NextResponse.json(
          {
            error: `No group members match Input Type "${InputType}" for "${Company}" / "${Provider}" / "${Category}"`,
          },
          { status: 404 }
        );
      }

      // CONFIRM every facility+period that appears in the payload.
      // Facilities not in this payload and months not in this payload are left untouched —
      // invoices may arrive separately. Call /api/ingestion/inferred-empty when done.
      for (const row of groupRows) {
        if (!row['Date Range'] || !row.Facility) {
          return NextResponse.json(
            { error: 'Row is missing Date Range or Facility' },
            { status: 422 }
          );
        }

        const parsed = parseDateRange(row['Date Range']);
        if (!parsed) {
          return NextResponse.json(
            {
              error: `Could not parse Date Range "${row['Date Range']}" — expected format: "DD/MM/YYYY - DD/MM/YYYY"`,
            },
            { status: 422 }
          );
        }

        const facilityId = facilityNameToId.get(row.Facility.toLowerCase());
        if (!facilityId) {
          return NextResponse.json(
            {
              error: `Facility "${row.Facility}" not found in group for "${Company}" / "${Provider}" / "${Category}"`,
            },
            { status: 404 }
          );
        }

        const { data: existing } = await supabase
          .from('non_metered_records')
          .select('id')
          .eq('facility_id', facilityId)
          .eq('supplier_id', supplier.id)
          .eq('input_type_id', targetInputTypeId)
          .eq('period_start_date', parsed.start)
          .eq('status', 'PENDING')
          .maybeSingle();

        if (existing) {
          await supabase
            .from('non_metered_records')
            .update({ status: 'CONFIRMED' })
            .eq('id', existing.id);
        } else {
          await supabase.from('non_metered_records').upsert(
            {
              facility_id: facilityId,
              supplier_id: supplier.id,
              input_type_id: targetInputTypeId,
              period_start_date: parsed.start,
              period_end_date: parsed.end,
              status: 'CONFIRMED',
            },
            {
              onConflict: 'facility_id,supplier_id,input_type_id,period_start_date,period_end_date',
              ignoreDuplicates: false,
            }
          );
        }
        totalConfirmed++;
      }
    }

    return NextResponse.json({ mode: 'group', confirmed: totalConfirmed });
  } catch (error) {
    console.error('Error in ingestion/confirm:', error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Internal server error', detail }, { status: 500 });
  }
}
