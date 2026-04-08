import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { resolveIngestionLine } from '@/lib/ingestion-line';
import { upsertNonMeteredLine, upsertNonMeteredLines } from '@/lib/non-metered-lines';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface NGERSRow {
  Company?: string;
  Facility?: string;
  Provider?: string;
  Category?: string;
  'Sub-Category'?: string;
  'Input Type'?: string;
  Consumption?: number;
  'Amount ($)'?: number;
  'Date Range'?: string;
  [key: string]: unknown;
}

interface GroupMember {
  facility_id: string | number;
  input_type_id: string | null;
  facility: { id: string | number; name: string } | null;
}

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

/** Compare period keys — DB may return "2026-03-01" or ISO datetime strings */
function periodKey(d: string | null | undefined): string {
  if (!d) return '';
  return String(d).slice(0, 10);
}

type LineConfirmResult = {
  confirmed: number;
  inferred_empty: number;
  deleted_pending: number;
  warnings: string[];
};

/**
 * Standalone line: each row's Category = record utility (e.g. GREASE), Facility = site name.
 * No facility group; no INFERRED_EMPTY for other facilities; only deletes orphaned PENDING
 * for this facility + supplier + category.
 */
async function processLineConfirm(
  supabase: SupabaseClient,
  rows: NGERSRow[]
): Promise<LineConfirmResult> {
  let totalConfirmed = 0;
  let totalDeletedPending = 0;
  const warnings: string[] = [];

  const groupedRows = new Map<string, NGERSRow[]>();
  for (const row of rows) {
    const facKey = (row.Facility ?? '').trim();
    const key = `${row.Company}__${row.Provider}__${row.Category}__${facKey}`;
    if (!groupedRows.has(key)) groupedRows.set(key, []);
    groupedRows.get(key)!.push(row);
  }

  for (const [, lineRows] of Array.from(groupedRows.entries())) {
    const { Company, Provider, Category, Facility } = lineRows[0];
    if (!Company || !Provider || !Category) {
      warnings.push('Row missing Company, Provider, or Category — skipped');
      continue;
    }

    const resolved = await resolveIngestionLine(
      supabase,
      Company,
      (Facility ?? '').trim(),
      Provider,
      Category
    );
    if (!resolved.ok) {
      warnings.push(`${resolved.error} — rows skipped`);
      continue;
    }

    const { facilityId, supplierId, categoryId } = resolved;

    // Ensure line registration exists.
    await upsertNonMeteredLine(supabase, { facilityId, supplierId, inputTypeId: categoryId });

    const confirmedPeriods = new Map<string, { start: string; end: string }>();
    const periodTotals = new Map<string, { consumption: number; amount: number }>();

    for (const row of lineRows) {
      if (!row['Date Range']) continue;
      const parsed = parseDateRange(row['Date Range']);
      if (!parsed) {
        warnings.push(`Could not parse Date Range "${row['Date Range']}" — row skipped`);
        continue;
      }
      confirmedPeriods.set(parsed.start, parsed);
      const prev = periodTotals.get(parsed.start) ?? { consumption: 0, amount: 0 };
      periodTotals.set(parsed.start, {
        consumption: prev.consumption + (Number(row.Consumption) || 0),
        amount: prev.amount + (Number(row['Amount ($)']) || 0),
      });
    }

    if (confirmedPeriods.size === 0) continue;

    const confirmedPeriodStarts = Array.from(confirmedPeriods.keys());

    const { data: allPending, error: pendingFetchErr } = await supabase
      .from('non_metered_records')
      .select('id, facility_id, input_type_id, period_start_date, status')
      .eq('facility_id', facilityId)
      .eq('supplier_id', supplierId)
      .eq('input_type_id', categoryId)
      .eq('status', 'PENDING');

    if (pendingFetchErr) throw new Error(pendingFetchErr.message);

    const pendingRecords = allPending ?? [];
    const confirmedKeys = new Set(confirmedPeriodStarts.map((p) => periodKey(p)));

    for (const [periodStart, period] of Array.from(confirmedPeriods.entries())) {
      const totals = periodTotals.get(periodStart) ?? { consumption: 0, amount: 0 };
      const pk = periodKey(periodStart);
      const existingPending = pendingRecords.find((r) => periodKey(r.period_start_date) === pk);

      if (existingPending) {
        const { error: updErr } = await supabase
          .from('non_metered_records')
          .update({
            status: 'CONFIRMED',
            consumption: totals.consumption,
            amount: totals.amount,
          })
          .eq('id', existingPending.id);
        if (updErr) throw new Error(updErr.message);
      } else {
        const { error: upErr } = await supabase.from('non_metered_records').upsert(
          {
            facility_id: facilityId,
            supplier_id: supplierId,
            input_type_id: categoryId,
            period_start_date: period.start,
            period_end_date: period.end,
            status: 'CONFIRMED',
            consumption: totals.consumption,
            amount: totals.amount,
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

    const orphanedPending = pendingRecords.filter(
      (r) => !confirmedKeys.has(periodKey(r.period_start_date))
    );
    if (orphanedPending.length > 0) {
      const orphanIds = orphanedPending.map((r) => r.id);
      const { error: delErr } = await supabase.from('non_metered_records').delete().in('id', orphanIds);
      if (delErr) throw new Error(delErr.message);
      totalDeletedPending += orphanIds.length;
    }
  }

  return {
    confirmed: totalConfirmed,
    inferred_empty: 0,
    deleted_pending: totalDeletedPending,
    warnings,
  };
}

// POST /api/ingestion/confirm
// Group mode: JSON array of NGERS rows (Category = group-level type; inference applies).
// Line mode: { "mode": "line", "rows": [ ... NGERS rows ... ] }
//   Category = record utility name; Facility = site; no INFERRED_EMPTY siblings.
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
    } else if (
      raw &&
      typeof raw === 'object' &&
      raw.mode === 'line' &&
      Array.isArray(raw.rows)
    ) {
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
      return NextResponse.json({ mode: 'line', ...result });
    }

    let totalConfirmed = 0;
    let totalInferredEmpty = 0;
    let totalDeletedPending = 0;
    const warnings: string[] = [];

    // Group rows by (Company, Provider, Category) — Category = group type
    const groupedRows = new Map<string, NGERSRow[]>();
    for (const row of rows) {
      const key = `${row.Company}__${row.Provider}__${row.Category}`;
      if (!groupedRows.has(key)) groupedRows.set(key, []);
      groupedRows.get(key)!.push(row);
    }

    for (const [, groupRows] of Array.from(groupedRows.entries())) {
      const { Company, Provider, Category } = groupRows[0];
      if (!Company || !Provider || !Category) continue;

      const [{ data: client }, { data: supplier }, { data: groupCategory }] = await Promise.all([
        supabase.from('clients').select('id').ilike('name', Company).single(),
        supabase.from('suppliers').select('id').ilike('name', Provider).single(),
        // Category in the NGERS row = the group-level type
        supabase.from('input_types').select('id').ilike('name', Category).single(),
      ]);

      if (!client) { warnings.push(`Client "${Company}" not found — rows skipped`); continue; }
      if (!supplier) { warnings.push(`Supplier "${Provider}" not found — rows skipped`); continue; }
      if (!groupCategory) { warnings.push(`Utility type "${Category}" not found — rows skipped`); continue; }

      const { data: group } = await supabase
        .from('facility_groups')
        .select(`
          id,
          members:facility_group_members(
            facility_id,
            input_type_id,
            facility:facilities(id, name)
          )
        `)
        .eq('client_id', client.id)
        .eq('supplier_id', supplier.id)
        .eq('input_type_id', groupCategory.id)
        .single();

      if (!group) {
        warnings.push(`No group for "${Company}" / "${Provider}" / "${Category}" — rows skipped`);
        continue;
      }

      const members = (group.members ?? []) as unknown as GroupMember[];

      // Build lookup maps
      const facilityNameToId = new Map<string, string>();
      const facilityIdToCategory = new Map<string, string>();
      const allMemberIds: string[] = [];

      for (const member of members) {
        const fid = String(member.facility_id);
        const fname = member.facility?.name;
        if (fname) facilityNameToId.set(fname.toLowerCase(), fid);
        if (member.input_type_id) {
          facilityIdToCategory.set(fid, member.input_type_id);
        }
        allMemberIds.push(fid);
      }

      // Register lines for all group members.
      await upsertNonMeteredLines(
        supabase,
        allMemberIds
          .filter((fid) => facilityIdToCategory.has(fid))
          .map((fid) => ({
            facilityId: fid,
            supplierId: supplier.id,
            inputTypeId: facilityIdToCategory.get(fid)!,
          }))
      );

      // Extract confirmed periods and aggregate consumption/amount per (period, facility)
      const confirmedPeriods = new Map<string, { start: string; end: string }>();
      const periodFacilityData = new Map<string, Map<string, { consumption: number; amount: number }>>();

      for (const row of groupRows) {
        if (!row['Date Range'] || !row.Facility) continue;

        const parsed = parseDateRange(row['Date Range']);
        if (!parsed) {
          warnings.push(`Could not parse Date Range "${row['Date Range']}" — row skipped`);
          continue;
        }

        confirmedPeriods.set(parsed.start, parsed);

        const facilityId = facilityNameToId.get(row.Facility.toLowerCase());
        if (!facilityId) {
          warnings.push(`Facility "${row.Facility}" not found in group for "${Company}" — row skipped`);
          continue;
        }

        if (!periodFacilityData.has(parsed.start)) {
          periodFacilityData.set(parsed.start, new Map());
        }
        const byFacility = periodFacilityData.get(parsed.start)!;
        const prev = byFacility.get(facilityId) ?? { consumption: 0, amount: 0 };
        byFacility.set(facilityId, {
          consumption: prev.consumption + (Number(row.Consumption) || 0),
          amount: prev.amount + (Number(row['Amount ($)']) || 0),
        });
      }

      if (confirmedPeriods.size === 0) continue;

      const confirmedPeriodStarts = Array.from(confirmedPeriods.keys());

      // Fetch all PENDING records for group members across all their categories
      const memberCategoryIds = Array.from(new Set(
        Array.from(facilityIdToCategory.values())
      ));

      const { data: allPending } = await supabase
        .from('non_metered_records')
        .select('id, facility_id, input_type_id, period_start_date, status')
        .in('facility_id', allMemberIds)
        .eq('supplier_id', supplier.id)
        .in('input_type_id', memberCategoryIds)
        .eq('status', 'PENDING');

      const pendingRecords = allPending ?? [];
      const confirmedPeriodKeySet = new Set(
        confirmedPeriodStarts.map((p) => periodKey(p))
      );

      // Step 1: Resolve records for confirmed periods
      for (const [periodStart, period] of Array.from(confirmedPeriods.entries())) {
        const byFacility = periodFacilityData.get(periodStart) ?? new Map();
        const periodStartKey = periodKey(periodStart);

        for (const memberId of allMemberIds) {
          const memberCatId = facilityIdToCategory.get(memberId);
          if (!memberCatId) {
            warnings.push(`Member facility ${memberId} has no utility category configured — skipped`);
            continue;
          }

          const existingPending = pendingRecords.find(
            (r) =>
              String(r.facility_id) === memberId &&
              r.input_type_id === memberCatId &&
              periodKey(r.period_start_date) === periodStartKey
          );

          if (byFacility.has(memberId)) {
            // Facility is present in invoice output → CONFIRMED
            const data = byFacility.get(memberId)!;
            if (existingPending) {
              await supabase
                .from('non_metered_records')
                .update({ status: 'CONFIRMED', consumption: data.consumption, amount: data.amount })
                .eq('id', existingPending.id);
            } else {
              await supabase.from('non_metered_records').upsert(
                {
                  facility_id: memberId,
                  supplier_id: supplier.id,
                  input_type_id: memberCatId,
                  period_start_date: period.start,
                  period_end_date: period.end,
                  status: 'CONFIRMED',
                  consumption: data.consumption,
                  amount: data.amount,
                },
                {
                  onConflict: 'facility_id,supplier_id,input_type_id,period_start_date,period_end_date',
                  ignoreDuplicates: false,
                }
              );
            }
            totalConfirmed++;
          } else {
            // Facility absent from invoice → INFERRED_EMPTY
            if (existingPending) {
              await supabase
                .from('non_metered_records')
                .update({ status: 'INFERRED_EMPTY' })
                .eq('id', existingPending.id);
            } else {
              await supabase.from('non_metered_records').upsert(
                {
                  facility_id: memberId,
                  supplier_id: supplier.id,
                  input_type_id: memberCatId,
                  period_start_date: period.start,
                  period_end_date: period.end,
                  status: 'INFERRED_EMPTY',
                },
                {
                  onConflict: 'facility_id,supplier_id,input_type_id,period_start_date,period_end_date',
                  ignoreDuplicates: true,
                }
              );
            }
            totalInferredEmpty++;
          }
        }
      }

      // Step 2: Delete PENDING records for months not covered by this invoice
      const orphanedPending = pendingRecords.filter(
        (r) => !confirmedPeriodKeySet.has(periodKey(r.period_start_date))
      );
      if (orphanedPending.length > 0) {
        const orphanIds = orphanedPending.map((r) => r.id);
        await supabase.from('non_metered_records').delete().in('id', orphanIds);
        totalDeletedPending += orphanIds.length;
      }
    }

    return NextResponse.json({
      mode: 'group',
      confirmed: totalConfirmed,
      inferred_empty: totalInferredEmpty,
      deleted_pending: totalDeletedPending,
      warnings,
    });
  } catch (error) {
    console.error('Error in ingestion/confirm:', error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Internal server error', detail }, { status: 500 });
  }
}
