/**
 * Shared confirm-state transition logic for all ingestion routes.
 *
 * Exports:
 *   confirmOrUpsertNonMeteredRecord  — atomic PENDING→CONFIRMED / upsert for non_metered_records
 *   processNonMeteredGroupRows       — group (facility_group) path
 *   processNonMeteredLineRows        — standalone line path
 *   processMeteredRows               — metered (actual_invoices) path
 *
 * Routes are thin adapters: parse request → call these functions → map result to NextResponse.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveIngestionLine } from '@/lib/ingestion-line';
import { findInputTypeForIngestion } from '@/lib/ingestion-utility-category';
import { parseNgersDateRange } from '@/lib/ingestion-dates';
import {
  parseMeterIdentifierFromNgersRow,
  resolveMeterForIngestion,
  METERED_GREEN_INVOICE_STATUSES,
  type NgersMeterRow,
} from '@/lib/ingestion-metered';
import { eachMonthStartIsoOverlapping } from '@/lib/metered-gap-pending';
import { upsertPendingMonthSlots } from '@/lib/meter-month-slots';
import {
  ensureLineInFacilityGroup,
  ensureLineInMatchingFacilityGroups,
  upsertNonMeteredLine,
} from '@/lib/non-metered-lines';

// ── Shared types ──────────────────────────────────────────────────────────────

export type UnifiedRow = Record<string, unknown>;

interface GroupMember {
  line: {
    facility_id: string | number;
    input_type_id: string | null;
    facility: { id: string | number; name: string } | null;
  } | null;
}

type ProcessorOk<T extends object> = T & { ok: true };
type ProcessorError = { ok: false; error: string; status: number };
export type ProcessorResult<T extends object> = ProcessorOk<T> | ProcessorError;


// ── Atomic non-metered DB operation ──────────────────────────────────────────

/**
 * If a PENDING row exists for this facility/supplier/inputType/periodStart, flip it to CONFIRMED.
 * Otherwise upsert a new CONFIRMED record.
 * Throws on Supabase error (caller should catch and surface as 500).
 */
export async function confirmOrUpsertNonMeteredRecord(
  supabase: SupabaseClient,
  params: {
    facilityId: string;
    supplierId: string;
    inputTypeId: string;
    periodStart: string;
    periodEnd: string;
    confirmedAt: string;
    /** When confirming via a facility group, attach new lines to this group. */
    groupId?: string;
  }
): Promise<void> {
  const { facilityId, supplierId, inputTypeId, periodStart, periodEnd, confirmedAt, groupId } = params;

  const { id: lineId, created } = await upsertNonMeteredLine(supabase, {
    facilityId,
    supplierId,
    inputTypeId,
  });

  if (created) {
    if (groupId) {
      await ensureLineInFacilityGroup(supabase, lineId, groupId);
    } else {
      await ensureLineInMatchingFacilityGroups(supabase, { lineId, facilityId, supplierId });
    }
  }

  const { data: existing } = await supabase
    .from('non_metered_records')
    .select('id')
    .eq('non_metered_line_id', lineId)
    .eq('period_start_date', periodStart)
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
        non_metered_line_id: lineId,
        facility_id: facilityId,
        supplier_id: supplierId,
        input_type_id: inputTypeId,
        period_start_date: periodStart,
        period_end_date: periodEnd,
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
}

// ── Non-metered GROUP processor ───────────────────────────────────────────────

export async function processNonMeteredGroupRows(
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

      const parsed = parseNgersDateRange(dateRange);
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
        const lineResolved = await resolveIngestionLine(supabase, Company, facility, Provider, InputType);
        if (!lineResolved.ok) {
          return { ok: false, error: lineResolved.error, status: lineResolved.status };
        }
        facilityId = lineResolved.facilityId;
      }

      await confirmOrUpsertNonMeteredRecord(supabase, {
        facilityId,
        supplierId: supplier.id,
        inputTypeId: targetInputTypeId,
        periodStart: parsed.start,
        periodEnd: parsed.end,
        confirmedAt,
        groupId: useFacilityGroup ? String(group!.id) : undefined,
      });
      totalConfirmed++;
    }
  }

  return { ok: true, confirmed: totalConfirmed };
}

// ── Non-metered LINE processor ────────────────────────────────────────────────

export async function processNonMeteredLineRows(
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

      const parsed = parseNgersDateRange(dateRange);
      if (!parsed) {
        return {
          ok: false,
          error: `Could not parse Date Range "${dateRange}" — expected format: "DD/MM/YYYY - DD/MM/YYYY"`,
          status: 422,
        };
      }

      await confirmOrUpsertNonMeteredRecord(supabase, {
        facilityId: String(facilityId),
        supplierId: String(supplierId),
        inputTypeId: String(categoryId),
        periodStart: parsed.start,
        periodEnd: parsed.end,
        confirmedAt,
      });
      totalConfirmed++;
    }
  }

  return { ok: true, confirmed: totalConfirmed };
}

// ── Metered processor ─────────────────────────────────────────────────────────

export async function processMeteredRows(
  supabase: SupabaseClient,
  rows: NgersMeterRow[],
  confirmedAt: string
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
    }

    if (confirmedPeriods.size === 0) continue;

    // Pre-fetch all PENDING and GREEN invoices for this meter covering the full range
    // of confirmed periods in one parallel query pair — replaces per-period selects.
    const periodList = Array.from(confirmedPeriods.values());
    const minStart = periodList.reduce((a, b) => (a.start < b.start ? a : b)).start;
    const maxEnd = periodList.reduce((a, b) => (a.end > b.end ? a : b)).end;

    const [{ data: allPending, error: pendFetchErr }, { data: allGreen, error: greenFetchErr }] =
      await Promise.all([
        supabase
          .from('actual_invoices')
          .select('id, period_start_date, period_end_date')
          .eq('meter_id', meterId)
          .eq('status', 'PENDING')
          .lte('period_start_date', maxEnd)
          .gte('period_end_date', minStart)
          .order('period_start_date', { ascending: true }),
        supabase
          .from('actual_invoices')
          .select('id, period_start_date, period_end_date')
          .eq('meter_id', meterId)
          .in('status', [...METERED_GREEN_INVOICE_STATUSES])
          .lte('period_start_date', maxEnd)
          .gte('period_end_date', minStart),
      ]);

    if (pendFetchErr) throw new Error(pendFetchErr.message);
    if (greenFetchErr) throw new Error(greenFetchErr.message);

    // Assign fetched PENDING rows to each confirmed period (overlap check).
    // allPending is already ordered by period_start_date asc so keepId = first match.
    const pendingByPeriod = new Map<string, Array<{ id: string }>>();
    for (const p of allPending ?? []) {
      const ps = String(p.period_start_date);
      const pe = String(p.period_end_date);
      for (const [psk, period] of confirmedPeriods.entries()) {
        if (ps <= period.end && pe >= period.start) {
          if (!pendingByPeriod.has(psk)) pendingByPeriod.set(psk, []);
          pendingByPeriod.get(psk)!.push({ id: p.id as string });
        }
      }
    }

    // Collect all duplicate pending IDs for a single batch delete after the loop.
    const allDupIds: string[] = [];
    // Collect new CONFIRMED rows (no prior pending) for a single batch insert.
    const newConfirmedRows: Array<Record<string, unknown>> = [];

    for (const [periodStartKey, period] of Array.from(confirmedPeriods.entries())) {
      const pendings = pendingByPeriod.get(periodStartKey) ?? [];

      if (pendings.length > 0) {
        const keepId = pendings[0].id;
        const dupIds = pendings.slice(1).map((p) => p.id);

        const { error: updErr } = await supabase
          .from('actual_invoices')
          .update({
            period_start_date: period.start,
            period_end_date: period.end,
            status: 'CONFIRMED',
            confirmed_at: confirmedAt,
          })
          .eq('id', keepId);

        if (updErr) throw new Error(updErr.message);
        allDupIds.push(...dupIds);
        totalConfirmed++;
      } else {
        // Exact duplicate check in memory (was: a separate DB select per period)
        const isDuplicate = (allGreen ?? []).some(
          (g) =>
            String(g.period_start_date) === period.start &&
            String(g.period_end_date) === period.end
        );
        if (isDuplicate) {
          // Idempotent: already confirmed — safe to skip
          totalSkippedDuplicates++;
          continue;
        }

        newConfirmedRows.push({
          meter_id: meterId,
          period_start_date: period.start,
          period_end_date: period.end,
          status: 'CONFIRMED',
          confirmed_at: confirmedAt,
        });
        totalConfirmed++;
      }
    }

    // Batch delete all duplicate pending rows in a single call
    if (allDupIds.length > 0) {
      const { error: delDupErr } = await supabase.from('actual_invoices').delete().in('id', allDupIds);
      if (delDupErr) throw new Error(delDupErr.message);
      totalDeletedPending += allDupIds.length;
    }

    // Batch insert all new CONFIRMED rows (those with no prior pending)
    if (newConfirmedRows.length > 0) {
      const { error: insErr } = await supabase.from('actual_invoices').insert(newConfirmedRows);
      if (insErr) throw new Error(insErr.message);
    }

    // Upsert a PENDING slot for every month touched by this confirmation.
    // ignoreDuplicates=true means existing ERROR/DEACTIVATED slots are left as-is.
    const sortedMonths = Array.from(monthKeysConfirmed).sort();
    if (sortedMonths.length > 0) {
      await upsertPendingMonthSlots(
        supabase,
        meterId,
        sortedMonths[0],
        sortedMonths[sortedMonths.length - 1]
      );
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
