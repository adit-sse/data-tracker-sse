import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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
  utility_category_id: string | null;
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

// POST /api/ingestion/confirm
// Called by the ingestion workflow after producing NGERS output rows.
// Category in each row identifies the group-level type (e.g. "Transport Fuels").
// Each group member carries its own utility_category_id (e.g. "Diesel", "Petrol"),
// and CONFIRMED / INFERRED_EMPTY records are written under that member-level category.
export async function POST(request: Request) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows: NGERSRow[] = await request.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: 'Request body must be a non-empty array of rows' },
        { status: 400 }
      );
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

    for (const [, groupRows] of groupedRows) {
      const { Company, Provider, Category } = groupRows[0];
      if (!Company || !Provider || !Category) continue;

      const [{ data: client }, { data: supplier }, { data: groupCategory }] = await Promise.all([
        supabase.from('clients').select('id').ilike('name', Company).single(),
        supabase.from('suppliers').select('id').ilike('name', Provider).single(),
        // Category in the NGERS row = the group-level type
        supabase.from('utility_categories').select('id').ilike('name', Category).single(),
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
            utility_category_id,
            facility:facilities(id, name)
          )
        `)
        .eq('client_id', client.id)
        .eq('supplier_id', supplier.id)
        .eq('utility_category_id', groupCategory.id)
        .single();

      if (!group) {
        warnings.push(`No group for "${Company}" / "${Provider}" / "${Category}" — rows skipped`);
        continue;
      }

      const members = (group.members ?? []) as GroupMember[];

      // Build lookup maps
      const facilityNameToId = new Map<string, string>();
      const facilityIdToCategory = new Map<string, string>();
      const allMemberIds: string[] = [];

      for (const member of members) {
        const fid = String(member.facility_id);
        const fname = member.facility?.name;
        if (fname) facilityNameToId.set(fname.toLowerCase(), fid);
        if (member.utility_category_id) {
          facilityIdToCategory.set(fid, member.utility_category_id);
        }
        allMemberIds.push(fid);
      }

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
        .select('id, facility_id, utility_category_id, period_start_date, status')
        .in('facility_id', allMemberIds)
        .eq('supplier_id', supplier.id)
        .in('utility_category_id', memberCategoryIds)
        .eq('status', 'PENDING');

      const pendingRecords = allPending ?? [];

      // Step 1: Resolve records for confirmed periods
      for (const [periodStart, period] of confirmedPeriods) {
        const byFacility = periodFacilityData.get(periodStart) ?? new Map();

        for (const memberId of allMemberIds) {
          const memberCatId = facilityIdToCategory.get(memberId);
          if (!memberCatId) {
            warnings.push(`Member facility ${memberId} has no utility category configured — skipped`);
            continue;
          }

          const existingPending = pendingRecords.find(
            (r) =>
              String(r.facility_id) === memberId &&
              r.utility_category_id === memberCatId &&
              r.period_start_date === periodStart
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
                  utility_category_id: memberCatId,
                  period_start_date: period.start,
                  period_end_date: period.end,
                  status: 'CONFIRMED',
                  consumption: data.consumption,
                  amount: data.amount,
                },
                {
                  onConflict: 'facility_id,supplier_id,utility_category_id,period_start_date,period_end_date',
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
                  utility_category_id: memberCatId,
                  period_start_date: period.start,
                  period_end_date: period.end,
                  status: 'INFERRED_EMPTY',
                },
                {
                  onConflict: 'facility_id,supplier_id,utility_category_id,period_start_date,period_end_date',
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
        (r) => !confirmedPeriodStarts.includes(r.period_start_date)
      );
      if (orphanedPending.length > 0) {
        const orphanIds = orphanedPending.map((r) => r.id);
        await supabase.from('non_metered_records').delete().in('id', orphanIds);
        totalDeletedPending += orphanIds.length;
      }
    }

    return NextResponse.json({
      confirmed: totalConfirmed,
      inferred_empty: totalInferredEmpty,
      deleted_pending: totalDeletedPending,
      warnings,
    });
  } catch (error) {
    console.error('Error in ingestion/confirm:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
