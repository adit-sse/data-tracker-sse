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
import { resolveIngestionLine, resolveNonMeteredCoverageWithoutFacilityGroup } from '@/lib/ingestion-line';
import { findInputTypeForIngestion } from '@/lib/ingestion-utility-category';
import { parseNgersDateRange, monthStartIso } from '@/lib/ingestion-dates';
import {
  parseMeterIdentifierFromNgersRow,
  resolveMeterForIngestion,
  meteredExactDuplicateExists,
  metaFromRow,
  type NgersMeterRow,
} from '@/lib/ingestion-metered';
import { eachMonthStartIsoOverlapping, syncMeteredGapPendingForMonths } from '@/lib/metered-gap-pending';
import { getCurrentFiscalYearMonthsThroughNow } from '@/lib/non-metered-pending-seed';

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

function periodKey(d: string | null | undefined): string {
  return d ? String(d).slice(0, 10) : '';
}

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
  }
): Promise<void> {
  const { facilityId, supplierId, inputTypeId, periodStart, periodEnd, confirmedAt } = params;

  const { data: existing } = await supabase
    .from('non_metered_records')
    .select('id')
    .eq('facility_id', facilityId)
    .eq('supplier_id', supplierId)
    .eq('input_type_id', inputTypeId)
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

      await confirmOrUpsertNonMeteredRecord(supabase, {
        facilityId,
        supplierId: supplier.id,
        inputTypeId: targetInputTypeId,
        periodStart: parsed.start,
        periodEnd: parsed.end,
        confirmedAt,
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
