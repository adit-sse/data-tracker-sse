export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { generateFiscalYearMonths } from '@/lib/coverage';
import { format } from 'date-fns';
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

    // non_metered_lines is the authoritative source for which rows appear in the grid.
    // A line exists for every registered (facility, supplier, utility category) combination,
    // even before any invoice records exist — enabling the "no data yet" state.
    const { data: lines, error: linesError } = await supabase
      .from('non_metered_lines')
      .select(`
        id,
        facility_id,
        supplier_id,
        input_type_id,
        category_id,
        is_active,
        supplier:suppliers(id, name),
        input_type:input_types!inner(id, name, scope, is_metered),
        category:categories(id, name, scope)
      `)
      .in('facility_id', facilityIds)
      .eq('input_types.scope', scope);

    if (linesError) throw linesError;

    if (!lines || lines.length === 0) {
      return NextResponse.json({ rows: [], fiscalYear });
    }

    // Fetch all records in the FY window for these facilities.
    // Scope filtering is handled via the lines query above; we fetch all records
    // and match them to lines when building coverage cells.
    const { data: records, error: recordsError } = await supabase
      .from('non_metered_records')
      .select('id, facility_id, supplier_id, input_type_id, period_start_date, period_end_date, status, inferred_from_id, created_at, confirmed_at')
      .in('facility_id', facilityIds)
      .lte('period_start_date', fyEnd)
      .gte('period_end_date', fyStart);

    if (recordsError) throw recordsError;

    // Build a map of records keyed by (facility_id, supplier_id, input_type_id)
    // so each line can look up its coverage records in O(1).
    const recordsByLineKey = new Map<string, any[]>();
    for (const rec of records || []) {
      const key = `${rec.facility_id}__${rec.supplier_id ?? 'null'}__${rec.input_type_id}`;
      if (!recordsByLineKey.has(key)) recordsByLineKey.set(key, []);
      recordsByLineKey.get(key)!.push(rec);
    }

    // Fetch group memberships so we can attach groupId/groupName to rows.
    // Members are now keyed on non_metered_line_id; join through the line to get facility/type.
    const { data: groupMembers } = await supabase
      .from('facility_group_members')
      .select(`
        line:non_metered_lines(facility_id, input_type_id),
        group:facility_groups!inner(id, name, supplier_id, client_id)
      `)
      .eq('facility_groups.client_id', clientId);

    type GroupInfo = { groupId: string; groupName: string };
    const groupByMemberKey = new Map<string, GroupInfo>();
    for (const gm of (groupMembers ?? []) as any[]) {
      const g = gm.group;
      const line = gm.line;
      if (!g || !line) continue;
      const key = `${line.facility_id}__${line.input_type_id}__${g.supplier_id}`;
      groupByMemberKey.set(key, { groupId: String(g.id), groupName: String(g.name) });
    }

    const fyMonths = generateFiscalYearMonths(fiscalYear);
    const rows: NonMeteredRowWithCoverage[] = [];

    for (const line of lines) {
      const lineKey = `${line.facility_id}__${line.supplier_id}__${line.input_type_id}`;
      const lineRecords = recordsByLineKey.get(lineKey) ?? [];

      const coverage: NonMeteredMonthlyCoverage[] = fyMonths.map((monthDate) => {
        const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
        const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
        const monthStartStr = format(monthStart, 'yyyy-MM-dd');
        const monthEndStr = format(monthEnd, 'yyyy-MM-dd');

        const overlapping = lineRecords.filter((r: any) => {
          return r.period_start_date <= monthEndStr && r.period_end_date >= monthStartStr;
        });

        if (overlapping.length === 0) {
          return {
            month: format(monthDate, 'MMM yy'),
            monthDate,
            status: null,
          };
        }

        // Prefer real data, then deactivated (explicitly marked off), then inferred/pending
        const real = overlapping.find((r: any) => r.status === 'CONFIRMED');
        const deactivated = overlapping.find((r: any) => r.status === 'DEACTIVATED');
        const best = real ?? deactivated ?? overlapping[0];

        return {
          month: format(monthDate, 'MMM yy'),
          monthDate,
          status: best.status as NonMeteredMonthlyCoverage['status'],
          record: best as NonMeteredRecord,
        };
      });

      const memberKey = `${line.facility_id}__${line.input_type_id}__${line.supplier_id}`;
      const groupInfo = groupByMemberKey.get(memberKey);

      const lineCategory = (line as any).category;

      rows.push({
        lineId: String(line.id),
        facilityId: String(line.facility_id),
        facilityName: facilityNameById[line.facility_id] || 'Unknown',
        supplierId: String(line.supplier_id),
        supplierName: (line.supplier as any)?.name || '—',
        inputTypeId: String(line.input_type_id),
        inputTypeName: (line.input_type as any)?.name || 'Unknown',
        categoryId: lineCategory?.id ? String(lineCategory.id) : null,
        categoryName: lineCategory?.name ?? null,
        groupId: groupInfo?.groupId,
        groupName: groupInfo?.groupName,
        isActive: (line as any).is_active !== false,
        coverage,
      });
    }

    // Sort: grouped rows first (by group name), then ungrouped by facility/supplier/category.
    rows.sort((a, b) => {
      const aGroup = a.groupName ?? '';
      const bGroup = b.groupName ?? '';

      if (aGroup && !bGroup) return -1;
      if (!aGroup && bGroup) return 1;
      if (aGroup !== bGroup) return aGroup.localeCompare(bGroup);

      const f = a.facilityName.localeCompare(b.facilityName);
      if (f !== 0) return f;
      const s = a.supplierName.localeCompare(b.supplierName);
      if (s !== 0) return s;
      return a.inputTypeName.localeCompare(b.inputTypeName);
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
