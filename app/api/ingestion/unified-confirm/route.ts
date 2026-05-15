import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { resolveIngestionLine, resolveNonMeteredCoverageWithoutFacilityGroup } from '@/lib/ingestion-line';
import { findInputTypeForIngestion } from '@/lib/ingestion-utility-category';
import { parseNgersDateRange, monthStartIso } from '@/lib/ingestion-dates';
import {
  parseMeterIdentifierFromNgersRow,
  resolveMeterForIngestion,
  meteredExactDuplicateExists,
  type NgersMeterRow,
} from '@/lib/ingestion-metered';
import { eachMonthStartIsoOverlapping, syncMeteredGapPendingForMonths } from '@/lib/metered-gap-pending';
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

type ProcessorOk<T extends object> = T & { ok: true };
type ProcessorError = { ok: false; error: string; status: number };
type ProcessorResult<T extends object> = ProcessorOk<T> | ProcessorError;

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
  rows: UnifiedRow[],
  confirmedAt: string
): Promise<ProcessorResult<{ confirmed: number }>> {
  let totalConfirmed = 0;

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
      return {
        ok: false,
        error: 'Non-metered group row missing Company, Provider, Category, or Input Type',
        status: 400,
      };
    }

    const [{ data: client }, { data: supplier }, { data: groupCategory }] = await Promise.all([
      supabase.from('clients').select('id').ilike('name', Company).single(),
      supabase.from('suppliers').select('id').ilike('name', Provider).single(),
      supabase.from('categories').select('id').ilike('name', Category).single(),
    ]);

    if (!client) return { ok: false, error: `Client "${Company}" not found`, status: 404 };
    if (!supplier) return { ok: false, error: `Supplier "${Provider}" not found`, status: 404 };
    if (!groupCategory) return { ok: false, error: `Category "${Category}" not found`, status: 404 };

    let targetInputTypeId: string;
    try {
      const resolved = await findInputTypeForIngestion(supabase, InputType);
      targetInputTypeId = resolved.id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg, status: 400 };
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

    const useFacilityGroup = Boolean(group);

    const facilityNameToId = new Map<string, string>();

    if (useFacilityGroup) {
      const members = (group!.members ?? []) as unknown as GroupMember[];

      for (const member of members) {
        const line = member.line;
        if (!line || !line.input_type_id) continue;
        if (line.input_type_id !== targetInputTypeId) continue;
        const fid = String(line.facility_id);
        const fname = line.facility?.name;
        if (fname) facilityNameToId.set(fname.toLowerCase(), fid);
      }

      if (facilityNameToId.size === 0) {
        return {
          ok: false,
          error: `No group members match Input Type "${InputType}" for "${Company}" / "${Provider}" / "${Category}"`,
          status: 404,
        };
      }
    }

    for (const row of groupRows) {
      const dateRange = typeof row['Date Range'] === 'string' ? row['Date Range'] : '';
      const facility = typeof row.Facility === 'string' ? row.Facility.trim() : '';

      if (!dateRange || !facility) {
        return { ok: false, error: 'Row is missing Date Range or Facility', status: 422 };
      }

      const parsed = parseDateRangeDDMMYYYY(dateRange);
      if (!parsed) {
        return {
          ok: false,
          error: `Could not parse Date Range "${dateRange}" — expected format: "DD/MM/YYYY - DD/MM/YYYY"`,
          status: 422,
        };
      }

      let facilityId: string;
      if (useFacilityGroup) {
        const fid = facilityNameToId.get(facility.toLowerCase());
        if (!fid) {
          return {
            ok: false,
            error: `Facility "${facility}" not found in group for "${Company}" / "${Provider}" / "${Category}"`,
            status: 404,
          };
        }
        facilityId = fid;
      } else {
        const lineResolved = await resolveNonMeteredCoverageWithoutFacilityGroup(supabase, {
          clientId: client.id,
          clientName: Company,
          facilityName: facility,
          supplierId: supplier.id,
          supplierName: Provider,
          categoryId: groupCategory.id,
          categoryName: Category,
          inputTypeId: targetInputTypeId,
          inputTypeName: InputType,
        });
        if (!lineResolved.ok) {
          return { ok: false, error: lineResolved.error, status: lineResolved.status };
        }
        facilityId = lineResolved.facilityId;
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
          .update({ status: 'CONFIRMED', confirmed_at: confirmedAt })
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
            confirmed_at: confirmedAt,
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

// ── Non-metered LINE processor ────────────────────────────────────────────────

async function processNonMeteredLineRows(
  supabase: SupabaseClient,
  rows: UnifiedRow[],
  confirmedAt: string
): Promise<ProcessorResult<{ confirmed: number }>> {
  let totalConfirmed = 0;

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
      return {
        ok: false,
        error: 'Non-metered line row missing Company, Provider, or Input Type',
        status: 400,
      };
    }

    const resolved = await resolveIngestionLine(supabase, Company, Facility, Provider, InputType);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error, status: resolved.status };
    }

    const { facilityId, supplierId, categoryId } = resolved;

    for (const row of lineRows) {
      const dateRange = typeof row['Date Range'] === 'string' ? row['Date Range'] : '';
      if (!dateRange) {
        return { ok: false, error: 'Row is missing Date Range', status: 422 };
      }

      const parsed = parseDateRangeDDMMYYYY(dateRange);
      if (!parsed) {
        return {
          ok: false,
          error: `Could not parse Date Range "${dateRange}" — expected format: "DD/MM/YYYY - DD/MM/YYYY"`,
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
          .update({ status: 'CONFIRMED', confirmed_at: confirmedAt })
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
            confirmed_at: confirmedAt,
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
  rows: NgersMeterRow[],
  confirmedAt: string,
  pruneOrphanPending: boolean
): Promise<
  ProcessorResult<{
    confirmed: number;
    deleted_pending: number;
    skipped_duplicates: number;
    gap_pending_inserted: number;
  }>
> {
  let totalConfirmed = 0;
  let totalDeletedPending = 0;
  let totalSkippedDuplicates = 0;
  let totalGapPendingInserted = 0;

  const groupedRows = new Map<string, NgersMeterRow[]>();
  for (const row of rows) {
    const iden = parseMeterIdentifierFromNgersRow(row);
    if (!iden.ok) {
      return { ok: false, error: iden.error, status: 400 };
    }
    const company = String(row.Company ?? '').trim();
    const provider = String(row.Provider ?? '').trim();
    const category = String(row.Category ?? '').trim();
    const fac = String(row.Facility ?? '').trim();
    if (!company || !provider || !category) {
      return {
        ok: false,
        error: 'Metered row missing Company, Provider, or Category',
        status: 400,
      };
    }
    const key = `${company}__${provider}__${category}__${fac}__${iden.identifier_type}__${iden.lookup1}`;
    if (!groupedRows.has(key)) groupedRows.set(key, []);
    groupedRows.get(key)!.push(row);
  }

  for (const [, groupRows] of Array.from(groupedRows.entries())) {
    const first = groupRows[0];
    const iden = parseMeterIdentifierFromNgersRow(first);
    if (!iden.ok) {
      return { ok: false, error: iden.error, status: 400 };
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
      return { ok: false, error: resolved.error, status: resolved.status };
    }

    const { meterId } = resolved;

    const confirmedPeriods = new Map<string, { start: string; end: string }>();
    const periodTotals = new Map<string, { consumption: number; amount: number }>();
    const monthKeysConfirmed = new Set<string>();

    for (const row of groupRows) {
      if (!row['Date Range']) {
        return { ok: false, error: 'Metered row is missing Date Range', status: 422 };
      }
      const parsed = parseNgersDateRange(String(row['Date Range']));
      if (!parsed) {
        return {
          ok: false,
          error: `Could not parse Date Range "${row['Date Range']}" — expected format: "DD/MM/YYYY - DD/MM/YYYY"`,
          status: 422,
        };
      }
      confirmedPeriods.set(parsed.start, parsed);
      for (const m of eachMonthStartIsoOverlapping(parsed.start, parsed.end)) {
        monthKeysConfirmed.add(m);
      }
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

      const { data: pendingList } = await supabase
        .from('actual_invoices')
        .select('id')
        .eq('meter_id', meterId)
        .eq('status', 'PENDING')
        .lte('period_start_date', period.end)
        .gte('period_end_date', period.start)
        .order('period_start_date', { ascending: true });

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
            confirmed_at: confirmedAt,
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
          // Idempotent: already confirmed — safe to skip
          totalSkippedDuplicates++;
          continue;
        }

        const { error: insErr } = await supabase.from('actual_invoices').insert({
          meter_id: meterId,
          period_start_date: period.start,
          period_end_date: period.end,
          consumption: totals.consumption,
          amount: totals.amount,
          status: 'CONFIRMED',
          confirmed_at: confirmedAt,
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

    const gapSync = await syncMeteredGapPendingForMonths(
      supabase,
      meterId,
      monthKeysConfirmed,
      confirmedAt
    );
    totalDeletedPending += gapSync.deleted;
    totalGapPendingInserted += gapSync.inserted;

    if (pruneOrphanPending) {
      const fyMonthStarts = new Set(getCurrentFiscalYearMonthsThroughNow().map((m) => m.start));
      const { data: pendingNow, error: pnErr } = await supabase
        .from('actual_invoices')
        .select('id, period_start_date')
        .eq('meter_id', meterId)
        .eq('status', 'PENDING');
      if (pnErr) throw new Error(pnErr.message);
      const orphaned = (pendingNow ?? []).filter((r) => {
        const pendingMonthStart = monthStartIso(periodKey(r.period_start_date));
        return !monthKeysConfirmed.has(pendingMonthStart) && fyMonthStarts.has(pendingMonthStart);
      });
      if (orphaned.length > 0) {
        const orphanIds = orphaned.map((r) => r.id);
        const { error: delErr } = await supabase.from('actual_invoices').delete().in('id', orphanIds);
        if (delErr) throw new Error(delErr.message);
        totalDeletedPending += orphanIds.length;
      }
    }
  }

  return {
    ok: true,
    confirmed: totalConfirmed,
    deleted_pending: totalDeletedPending,
    skipped_duplicates: totalSkippedDuplicates,
    gap_pending_inserted: totalGapPendingInserted,
  };
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
// Body: non-empty JSON array of NGERS rows (types can be mixed), or
//       { "rows": [ ... ], "prune_orphan_pending"?: boolean } for optional legacy FY-wide pending prune.
//
// All lookup failures (client, supplier, category, input type, facility, date range) return
// a hard 4xx — nothing is silently skipped.
//
// Response on success:
//   {
//     "non_metered": { "confirmed": n },
//     "metered":     { "confirmed": n, "deleted_pending": n, "skipped_duplicates": n, "gap_pending_inserted": n }
//   }
export async function POST(request: Request) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const raw = await request.json();

    let rows: UnifiedRow[];
    let pruneOrphanPending = false;

    if (Array.isArray(raw)) {
      if (raw.length === 0) {
        return NextResponse.json(
          { error: 'Request body must be a non-empty JSON array of NGERS rows' },
          { status: 400 }
        );
      }
      rows = raw as UnifiedRow[];
    } else if (
      raw &&
      typeof raw === 'object' &&
      Array.isArray((raw as { rows?: unknown }).rows) &&
      ((raw as { rows: unknown[] }).rows as unknown[]).length > 0
    ) {
      rows = (raw as { rows: UnifiedRow[] }).rows;
      pruneOrphanPending = Boolean((raw as { prune_orphan_pending?: unknown }).prune_orphan_pending);
    } else {
      return NextResponse.json(
        {
          error:
            'Request body must be a non-empty JSON array of NGERS rows, or an object { "rows": [ ... ] }',
        },
        { status: 400 }
      );
    }

    const confirmedAt = new Date().toISOString();

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
        ? processNonMeteredGroupRows(supabase, nmGroupRows, confirmedAt)
        : Promise.resolve({ ok: true as const, confirmed: 0 }),
      nmLineRows.length > 0
        ? processNonMeteredLineRows(supabase, nmLineRows, confirmedAt)
        : Promise.resolve({ ok: true as const, confirmed: 0 }),
      meteredRows.length > 0
        ? processMeteredRows(supabase, meteredRows, confirmedAt, pruneOrphanPending)
        : Promise.resolve({
            ok: true as const,
            confirmed: 0,
            deleted_pending: 0,
            skipped_duplicates: 0,
            gap_pending_inserted: 0,
          }),
    ]);

    if (!nonMeteredGroupResult.ok) {
      return NextResponse.json({ error: nonMeteredGroupResult.error }, { status: nonMeteredGroupResult.status });
    }
    if (!nonMeteredLineResult.ok) {
      return NextResponse.json({ error: nonMeteredLineResult.error }, { status: nonMeteredLineResult.status });
    }
    if (!meteredResult.ok) {
      return NextResponse.json({ error: meteredResult.error }, { status: meteredResult.status });
    }

    return NextResponse.json({
      non_metered: {
        confirmed: nonMeteredGroupResult.confirmed + nonMeteredLineResult.confirmed,
      },
      metered: {
        confirmed: meteredResult.confirmed,
        deleted_pending: meteredResult.deleted_pending,
        skipped_duplicates: meteredResult.skipped_duplicates,
        gap_pending_inserted: meteredResult.gap_pending_inserted,
      },
    });
  } catch (error) {
    console.error('Error in ingestion/unified-confirm:', error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Internal server error', detail }, { status: 500 });
  }
}
