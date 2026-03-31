export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { generateFiscalYearMonths } from '@/lib/coverage';
import { format, parseISO, isValid } from 'date-fns';
import type { NonMeteredRowWithCoverage, NonMeteredMonthlyCoverage, NonMeteredRecord } from '@/types';

// GET /api/clients/[id]/coverage/non-metered?fiscalYear=YYYY&scope=1
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const { searchParams } = new URL(request.url);
    const fiscalYearParam = searchParams.get('fiscalYear');
    const scope = parseInt(searchParams.get('scope') || '1', 10);

    const now = new Date();
    const currentFY = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
    const fiscalYear = fiscalYearParam ? parseInt(fiscalYearParam, 10) : currentFY;

    const clientId = params.id;

    // Fiscal year window: Jul (FY-1) to Jun (FY)
    const fyStart = `${fiscalYear - 1}-07-01`;
    const fyEnd = `${fiscalYear}-06-30`;

    // Get all facilities for this client
    const { data: facilities, error: facilitiesError } = await supabase
      .from('facilities')
      .select('id, name')
      .eq('client_id', clientId);

    if (facilitiesError) throw facilitiesError;

    const facilityIds = (facilities || []).map((f: any) => f.id);
    const facilityNameById = Object.fromEntries((facilities || []).map((f: any) => [f.id, f.name]));

    if (facilityIds.length === 0) {
      return NextResponse.json({ rows: [], fiscalYear });
    }

    // Fetch all non_metered_records for this client's facilities in the FY window,
    // filtered to the requested scope via the joined utility_categories table.
    // A record overlaps the window if period_start_date <= fyEnd AND period_end_date >= fyStart.
    const { data: records, error: recordsError } = await supabase
      .from('non_metered_records')
      .select(`
        *,
        supplier:suppliers(id, name),
        utility_category:utility_categories!inner(id, name, scope, is_metered)
      `)
      .in('facility_id', facilityIds)
      .lte('period_start_date', fyEnd)
      .gte('period_end_date', fyStart)
      .eq('utility_categories.scope', scope);

    if (recordsError) throw recordsError;

    if (!records || records.length === 0) {
      return NextResponse.json({ rows: [], fiscalYear });
    }

    // Fetch group memberships for this client so we can attach groupId/groupName to rows.
    // Members now carry their own utility_category_id; we match on (facility_id, utility_category_id, supplier).
    const { data: groupMembers } = await supabase
      .from('facility_group_members')
      .select(`
        facility_id,
        utility_category_id,
        group:facility_groups!inner(id, name, supplier_id, client_id)
      `)
      .eq('facility_groups.client_id', clientId);

    // Build a map: "facility_id__utility_category_id__supplier_id" → { groupId, groupName }
    type GroupInfo = { groupId: string; groupName: string };
    const groupByMemberKey = new Map<string, GroupInfo>();
    for (const gm of groupMembers ?? []) {
      const g = (gm as any).group;
      if (!g) continue;
      const key = `${gm.facility_id}__${gm.utility_category_id}__${g.supplier_id}`;
      groupByMemberKey.set(key, { groupId: String(g.id), groupName: String(g.name) });
    }

    // Generate the 12 months for this fiscal year
    const fyMonths = generateFiscalYearMonths(fiscalYear);

    // Group records by (facility_id, supplier_id, utility_category_id)
    const groupKey = (r: any) =>
      `${r.facility_id}__${r.supplier_id ?? 'null'}__${r.utility_category_id}`;

    const grouped = new Map<string, any[]>();
    for (const rec of records) {
      const key = groupKey(rec);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(rec);
    }

    const rows: NonMeteredRowWithCoverage[] = [];

    for (const [key, groupRecords] of Array.from(grouped.entries())) {
      const sample = groupRecords[0];

      const coverage: NonMeteredMonthlyCoverage[] = fyMonths.map((monthDate) => {
        const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
        const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
        const monthStartStr = format(monthStart, 'yyyy-MM-dd');
        const monthEndStr = format(monthEnd, 'yyyy-MM-dd');

        // Find records overlapping this month
        const overlapping = groupRecords.filter((r: any) => {
          const rStart = r.period_start_date;
          const rEnd = r.period_end_date;
          return rStart <= monthEndStr && rEnd >= monthStartStr;
        });

        if (overlapping.length === 0) {
          return {
            month: format(monthDate, 'MMM yy'),
            monthDate,
            status: null,
          };
        }

        // Prefer real data, then deactivated (explicitly marked off), then inferred
        const real = overlapping.find(
          (r: any) =>
            r.status === 'IMPORTED' ||
            r.status === 'MANUAL' ||
            r.status === 'CONFIRMED',
        );
        const deactivated = overlapping.find((r: any) => r.status === 'DEACTIVATED');
        const best = real ?? deactivated ?? overlapping[0];

        return {
          month: format(monthDate, 'MMM yy'),
          monthDate,
          status: best.status as NonMeteredMonthlyCoverage['status'],
          record: best as NonMeteredRecord,
        };
      });

      const memberKey = `${sample.facility_id}__${sample.utility_category_id}__${sample.supplier_id}`;
      const groupInfo = groupByMemberKey.get(memberKey);

      rows.push({
        facilityId: String(sample.facility_id),
        facilityName: facilityNameById[sample.facility_id] || 'Unknown',
        supplierId: sample.supplier_id ? String(sample.supplier_id) : null,
        supplierName: sample.supplier?.name || '—',
        categoryId: String(sample.utility_category_id),
        categoryName: sample.utility_category?.name || 'Unknown',
        groupId: groupInfo?.groupId,
        groupName: groupInfo?.groupName,
        coverage,
      });
    }

    // Sort: grouped rows first (by group name), then ungrouped rows by facility/supplier/category.
    // Within a group, sort by facility name then category name.
    rows.sort((a, b) => {
      const aGroup = a.groupName ?? '';
      const bGroup = b.groupName ?? '';

      // Ungrouped rows sink to the bottom
      if (aGroup && !bGroup) return -1;
      if (!aGroup && bGroup) return 1;

      if (aGroup !== bGroup) return aGroup.localeCompare(bGroup);

      const f = a.facilityName.localeCompare(b.facilityName);
      if (f !== 0) return f;
      const s = a.supplierName.localeCompare(b.supplierName);
      if (s !== 0) return s;
      return a.categoryName.localeCompare(b.categoryName);
    });

    return NextResponse.json({ rows, fiscalYear });
  } catch (error) {
    console.error('Error fetching non-metered coverage:', error);
    return NextResponse.json(
      { error: 'Failed to fetch non-metered coverage data' },
      { status: 500 }
    );
  }
}
