import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { resolveIngestionLine } from '@/lib/ingestion-line';
import { findInputTypeForIngestion } from '@/lib/ingestion-utility-category';
import { parseNgersDateRange, monthStartIso } from '@/lib/ingestion-dates';
import {
  parseMeterIdentifierFromNgersRow,
  resolveMeterForIngestion,
  meteredExactDuplicateExists,
  type NgersMeterRow,
} from '@/lib/ingestion-metered';
import { getCurrentFiscalYearMonthsThroughNow } from '@/lib/non-metered-pending-seed';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ── Shared types ─────────────────────────────────────────────────────────────

type UnifiedRow = Record<string, unknown>;

interface GroupMember {
  line: {
    facility_id: string | number;
    input_type_id: string | null;
    facility: { id: string | number; name: string } | null;
  } | null;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function checkApiKey(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === process.env.INGESTION_API_KEY;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function parseDateRangeDDMMYYYY(dateRange: string): { start: string; end: string } | null {
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

function periodKey(d: string | null | undefined): string {
  return d ? String(d).slice(0, 10) : '';
}

// ── Row classification ────────────────────────────────────────────────────────

type RowType = 'metered' | 'nm_group' | 'nm_line';

function classifyRow(row: UnifiedRow): RowType {
  const iden = parseMeterIdentifierFromNgersRow(row as NgersMeterRow);
  if (iden.ok) return 'metered';
  const category = typeof row.Category === 'string' ? row.Category.trim() : '';
  return category ? 'nm_group' : 'nm_line';
}

// ── Non-metered GROUP processor ───────────────────────────────────────────────

async function processNonMeteredGroupRows(
  supabase: SupabaseClient,
  rows: UnifiedRow[]
): Promise<{ confirmed: number; warnings: string[] }> {
  let totalConfirmed = 0;
  const warnings: string[] = [];

  const groupedRows = new Map<string, UnifiedRow[]>();
  for (const row of rows) {
    const catKey = (typeof row.Category === 'string' ? row.Category : '').trim();
    const inputTypeKey = (typeof row['Input Type'] === 'string' ? row['Input Type'] : '').trim();
    const key = `${row.Company}__${row.Provider}__${catKey}__${inputTypeKey}`;
    if (!groupedRows.has(key)) groupedRows.set(key, []);
    groupedRows.get(key)!.push(row);
  }

  for (const [, groupRows] of Array.from(groupedRows.entries())) {
    const Company = typeof groupRows[0].Company === 'string' ? groupRows[0].Company.trim() : '';
    const Provider = typeof groupRows[0].Provider === 'string' ? groupRows[0].Provider.trim() : '';
    const Category = typeof groupRows[0].Category === 'string' ? groupRows[0].Category.trim() : '';
    const InputType = typeof groupRows[0]['Input Type'] === 'string' ? (groupRows[0]['Input Type'] as string).trim() : '';

    if (!Company || !Provider || !Category || !InputType) {
      warnings.push('Non-metered group row missing Company, Provider, Category, or Input Type — rows skipped');
      continue;
    }

    const [{ data: client }, { data: supplier }, { data: groupCategory }] = await Promise.all([
      supabase.from('clients').select('id').ilike('name', Company).single(),
      supabase.from('suppliers').select('id').ilike('name', Provider).single(),
      supabase.from('categories').select('id').ilike('name', Category).single(),
    ]);

    if (!client) { warnings.push(`Client "${Company}" not found — rows skipped`); continue; }
    if (!supplier) { warnings.push(`Supplier "${Provider}" not found — rows skipped`); continue; }
    if (!groupCategory) { warnings.push(`Category "${Category}" not found — rows skipped`); continue; }

    let targetInputTypeId: string;
    try {
      const resolved = await findInputTypeForIngestion(supabase, InputType);
      targetInputTypeId = resolved.id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`${msg} — rows skipped`);
      continue;
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
      warnings.push(`No group for "${Company}" / "${Provider}" / "${Category}" — rows skipped`);
      continue;
    }

    const members = (group.members ?? []) as unknown as GroupMember[];
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
      warnings.push(`No group members match Input Type "${InputType}" for "${Company}" / "${Provider}" / "${Category}" — rows skipped`);
      continue;
    }

    for (const row of groupRows) {
      const dateRange = typeof row['Date Range'] === 'string' ? row['Date Range'] : '';
      const facility = typeof row.Facility === 'string' ? row.Facility.trim() : '';
      if (!dateRange || !facility) continue;

      const parsed = parseDateRangeDDMMYYYY(dateRange);
      if (!parsed) {
        warnings.push(`Could not parse Date Range "${dateRange}" — row skipped`);
        continue;
      }

      const facilityId = facilityNameToId.get(facility.toLowerCase());
      if (!facilityId) {
        warnings.push(`Facility "${facility}" not found in group for "${Company}" — row skipped`);
        continue;
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
        const { error: updErr } = await supabase
          .from('non_metered_records')
          .update({ status: 'CONFIRMED' })
          .eq('id', existing.id);
        if (updErr) throw new Error(updErr.message);
      } else {
        const { error: upErr } = await supabase.from('non_metered_records').upsert(
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
        if (upErr) throw new Error(upErr.message);
      }
      totalConfirmed++;
    }
  }

  return { confirmed: totalConfirmed, warnings };
}

// ── Non-metered LINE processor ────────────────────────────────────────────────

async function processNonMeteredLineRows(
  supabase: SupabaseClient,
  rows: UnifiedRow[]
): Promise<{ confirmed: number; warnings: string[] }> {
  let totalConfirmed = 0;
  const warnings: string[] = [];

  const groupedRows = new Map<string, UnifiedRow[]>();
  for (const row of rows) {
    const facKey = (typeof row.Facility === 'string' ? row.Facility : '').trim();
    const inputTypeKey = (typeof row['Input Type'] === 'string' ? row['Input Type'] : '').trim();
    const key = `${row.Company}__${row.Provider}__${inputTypeKey}__${facKey}`;
    if (!groupedRows.has(key)) groupedRows.set(key, []);
    groupedRows.get(key)!.push(row);
  }

  for (const [, lineRows] of Array.from(groupedRows.entries())) {
    const Company = typeof lineRows[0].Company === 'string' ? lineRows[0].Company.trim() : '';
    const Provider = typeof lineRows[0].Provider === 'string' ? lineRows[0].Provider.trim() : '';
    const Facility = typeof lineRows[0].Facility === 'string' ? lineRows[0].Facility.trim() : '';
    const InputType = typeof lineRows[0]['Input Type'] === 'string' ? (lineRows[0]['Input Type'] as string).trim() : '';

    if (!Company || !Provider || !InputType) {
      warnings.push('Non-metered line row missing Company, Provider, or Input Type — rows skipped');
      continue;
    }

    const resolved = await resolveIngestionLine(supabase, Company, Facility, Provider, InputType);
    if (!resolved.ok) {
      warnings.push(`${resolved.error} — rows skipped`);
      continue;
    }

    const { facilityId, supplierId, categoryId } = resolved;

    for (const row of lineRows) {
      const dateRange = typeof row['Date Range'] === 'string' ? row['Date Range'] : '';
      if (!dateRange) continue;

      const parsed = parseDateRangeDDMMYYYY(dateRange);
      if (!parsed) {
        warnings.push(`Could not parse Date Range "${dateRange}" — row skipped`);
        continue;
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

  return { confirmed: totalConfirmed, warnings };
}

// ── Metered processor ─────────────────────────────────────────────────────────

function metaFromRow(row: NgersMeterRow) {
  return {
    invoice_number:
      typeof row['Invoice Number'] === 'string' && row['Invoice Number'].trim()
        ? String(row['Invoice Number']).trim()
        : null,
    invoice_date:
      typeof row['Invoice Date'] === 'string' && row['Invoice Date'].trim()
        ? String(row['Invoice Date']).trim()
        : null,
    framework:
      typeof row.Framework === 'string' && row.Framework.trim()
        ? String(row.Framework).trim()
        : null,
    version:
      typeof row.Version === 'string' && row.Version.trim()
        ? String(row.Version).trim()
        : null,
    input_type:
      typeof row['Input Type'] === 'string' && row['Input Type'].trim()
        ? String(row['Input Type']).trim()
        : null,
    customer:
      typeof row.Customer === 'string' && row.Customer.trim()
        ? String(row.Customer).trim()
        : null,
  };
}

async function processMeteredRows(
  supabase: SupabaseClient,
  rows: NgersMeterRow[]
): Promise<{ confirmed: number; deleted_pending: number; warnings: string[] }> {
  let totalConfirmed = 0;
  let totalDeletedPending = 0;
  const warnings: string[] = [];

  const groupedRows = new Map<string, NgersMeterRow[]>();
  for (const row of rows) {
    const iden = parseMeterIdentifierFromNgersRow(row);
    if (!iden.ok) {
      warnings.push(iden.error);
      continue;
    }
    const company = String(row.Company ?? '').trim();
    const provider = String(row.Provider ?? '').trim();
    const category = String(row.Category ?? '').trim();
    const fac = String(row.Facility ?? '').trim();
    if (!company || !provider || !category) {
      warnings.push('Metered row missing Company, Provider, or Category — skipped');
      continue;
    }
    const key = `${company}__${provider}__${category}__${fac}__${iden.identifier_type}__${iden.lookup1}`;
    if (!groupedRows.has(key)) groupedRows.set(key, []);
    groupedRows.get(key)!.push(row);
  }

  for (const [, groupRows] of Array.from(groupedRows.entries())) {
    const first = groupRows[0];
    const iden = parseMeterIdentifierFromNgersRow(first);
    if (!iden.ok) {
      warnings.push(iden.error);
      continue;
    }

    const resolved = await resolveMeterForIngestion(supabase, {
      clientName: String(first.Company ?? '').trim(),
      facilityName: String(first.Facility ?? '').trim(),
      supplierName: String(first.Provider ?? '').trim(),
      utilityName: String(first.Category ?? '').trim(),
      identifierType: iden.identifier_type,
      lookup1: iden.lookup1,
      lookup2: iden.lookup2,
    });

    if (!resolved.ok) {
      warnings.push(`${resolved.error} — rows skipped`);
      continue;
    }

    const { meterId } = resolved;

    const { data: allPending, error: pendErr } = await supabase
      .from('actual_invoices')
      .select('id, period_start_date')
      .eq('meter_id', meterId)
      .eq('status', 'PENDING');

    if (pendErr) throw new Error(pendErr.message);

    const confirmedPeriods = new Map<string, { start: string; end: string }>();
    const periodTotals = new Map<string, { consumption: number; amount: number }>();
    const monthKeysConfirmed = new Set<string>();

    for (const row of groupRows) {
      if (!row['Date Range']) continue;
      const parsed = parseNgersDateRange(String(row['Date Range']));
      if (!parsed) {
        warnings.push(`Could not parse Date Range "${row['Date Range']}" — row skipped`);
        continue;
      }
      confirmedPeriods.set(parsed.start, parsed);
      monthKeysConfirmed.add(monthStartIso(parsed.start));
      const prev = periodTotals.get(parsed.start) ?? { consumption: 0, amount: 0 };
      periodTotals.set(parsed.start, {
        consumption: prev.consumption + (Number(row.Consumption) || 0),
        amount: prev.amount + (Number(row['Amount ($)']) || 0),
      });
    }

    if (confirmedPeriods.size === 0) continue;

    const meta = metaFromRow(first);

    for (const [periodStartKey, period] of Array.from(confirmedPeriods.entries())) {
      const totals = periodTotals.get(periodStartKey) ?? { consumption: 0, amount: 0 };
      const monthStart = monthStartIso(periodStartKey);

      const { data: pendingList } = await supabase
        .from('actual_invoices')
        .select('id')
        .eq('meter_id', meterId)
        .eq('status', 'PENDING')
        .eq('period_start_date', monthStart);

      const pendings = pendingList ?? [];

      if (pendings.length > 0) {
        const keepId = pendings[0].id;
        const dupIds = pendings.slice(1).map((p) => p.id);

        const { error: updErr } = await supabase
          .from('actual_invoices')
          .update({
            period_start_date: period.start,
            period_end_date: period.end,
            consumption: totals.consumption,
            amount: totals.amount,
            status: 'CONFIRMED',
            invoice_number: meta.invoice_number,
            invoice_date: meta.invoice_date,
            framework: meta.framework,
            version: meta.version,
            input_type: meta.input_type,
            customer: meta.customer,
          })
          .eq('id', keepId);

        if (updErr) throw new Error(updErr.message);

        if (dupIds.length > 0) {
          const { error: delDupErr } = await supabase.from('actual_invoices').delete().in('id', dupIds);
          if (delDupErr) throw new Error(delDupErr.message);
          totalDeletedPending += dupIds.length;
        }
        totalConfirmed++;
      } else {
        const isDuplicate = await meteredExactDuplicateExists(supabase, meterId, period.start, period.end);
        if (isDuplicate) {
          warnings.push(`Meter ${meterId}: identical invoice period ${period.start}–${period.end} already confirmed — skipped`);
          continue;
        }

        const { error: insErr } = await supabase.from('actual_invoices').insert({
          meter_id: meterId,
          period_start_date: period.start,
          period_end_date: period.end,
          consumption: totals.consumption,
          amount: totals.amount,
          status: 'CONFIRMED',
          invoice_number: meta.invoice_number,
          invoice_date: meta.invoice_date,
          framework: meta.framework,
          version: meta.version,
          input_type: meta.input_type,
          customer: meta.customer,
        });

        if (insErr) throw new Error(insErr.message);
        totalConfirmed++;
      }
    }

    const fyMonthStarts = new Set(getCurrentFiscalYearMonthsThroughNow().map((m) => m.start));
    const orphaned = (allPending ?? []).filter((r) => {
      const pk = periodKey(r.period_start_date);
      return !monthKeysConfirmed.has(pk) && fyMonthStarts.has(pk);
    });

    if (orphaned.length > 0) {
      const orphanIds = orphaned.map((r) => r.id);
      const { error: delErr } = await supabase.from('actual_invoices').delete().in('id', orphanIds);
      if (delErr) throw new Error(delErr.message);
      totalDeletedPending += orphanIds.length;
    }
  }

  return { confirmed: totalConfirmed, deleted_pending: totalDeletedPending, warnings };
}

// ── Route handler ─────────────────────────────────────────────────────────────

// POST /api/ingestion/unified-confirm
//
// Unified endpoint — handles non-metered group, non-metered line, and metered
// (Scope 2) rows in a single call. Row type is auto-detected per row:
//
//   Has NMI / MIRN / Account Number / Meter Number  → metered path (actual_invoices)
//   No meter identifier + non-empty Category        → non-metered group path (facility_groups)
//   No meter identifier + no Category               → non-metered line path (non_metered_lines)
//
// Body: flat JSON array of NGERS rows (types can be mixed in one request).
//
// Response:
//   {
//     "non_metered": { "confirmed": n, "warnings": [] },
//     "metered":     { "confirmed": n, "deleted_pending": n, "warnings": [] }
//   }
export async function POST(request: Request) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const raw = await request.json();

    if (!Array.isArray(raw) || raw.length === 0) {
      return NextResponse.json(
        { error: 'Request body must be a non-empty JSON array of NGERS rows' },
        { status: 400 }
      );
    }

    const rows = raw as UnifiedRow[];

    const meteredRows: NgersMeterRow[] = [];
    const nmGroupRows: UnifiedRow[] = [];
    const nmLineRows: UnifiedRow[] = [];

    for (const row of rows) {
      const type = classifyRow(row);
      if (type === 'metered') meteredRows.push(row as NgersMeterRow);
      else if (type === 'nm_group') nmGroupRows.push(row);
      else nmLineRows.push(row);
    }

    const [nonMeteredGroupResult, nonMeteredLineResult, meteredResult] = await Promise.all([
      nmGroupRows.length > 0
        ? processNonMeteredGroupRows(supabase, nmGroupRows)
        : Promise.resolve({ confirmed: 0, warnings: [] }),
      nmLineRows.length > 0
        ? processNonMeteredLineRows(supabase, nmLineRows)
        : Promise.resolve({ confirmed: 0, warnings: [] }),
      meteredRows.length > 0
        ? processMeteredRows(supabase, meteredRows)
        : Promise.resolve({ confirmed: 0, deleted_pending: 0, warnings: [] }),
    ]);

    return NextResponse.json({
      non_metered: {
        confirmed: nonMeteredGroupResult.confirmed + nonMeteredLineResult.confirmed,
        warnings: [...nonMeteredGroupResult.warnings, ...nonMeteredLineResult.warnings],
      },
      metered: meteredResult,
    });
  } catch (error) {
    console.error('Error in ingestion/unified-confirm:', error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Internal server error', detail }, { status: 500 });
  }
}
