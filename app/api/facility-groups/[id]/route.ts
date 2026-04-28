export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { runGroupBackfill } from '@/lib/facility-group-backfill';

const GROUP_SELECT = `
  *,
  supplier:suppliers(id, name),
  category:categories(id, name),
  members:facility_group_members(
    id,
    non_metered_line_id,
    line:non_metered_lines(
      id,
      facility_id,
      supplier_id,
      input_type_id,
      facility:facilities(id, name),
      input_type:input_types(id, name)
    )
  )
`;

// PUT /api/facility-groups/[id] — update group name and/or members + run backfill
// Body: { name?: string, category_id?: string,
//         facility_ids?: { facility_id: string, input_type_id: string }[] }
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const groupId = params.id;
    const body = await request.json();
    const { name, category_id, facility_ids } = body;

    // Fetch group for supplier_id (needed for backfill + line lookup)
    const { data: group, error: groupFetchError } = await supabase
      .from('facility_groups')
      .select('supplier_id')
      .eq('id', groupId)
      .single();

    if (groupFetchError) throw groupFetchError;

    const groupUpdates: Record<string, unknown> = {};
    if (name !== undefined) {
      if (!name?.trim()) {
        return NextResponse.json({ error: 'Group name cannot be empty' }, { status: 400 });
      }
      groupUpdates.name = name.trim();
    }
    if (category_id !== undefined) {
      groupUpdates.category_id = category_id || null;
    }
    if (Object.keys(groupUpdates).length > 0) {
      const { error: updateError } = await supabase
        .from('facility_groups')
        .update(groupUpdates)
        .eq('id', groupId);
      if (updateError) throw updateError;
    }

    let memberFacilityIds: string[] | null = null;

    if (Array.isArray(facility_ids)) {
      const members: { facility_id: string; input_type_id: string }[] = facility_ids;
      memberFacilityIds = [...new Set(members.map((m) => m.facility_id))];

      // Replace all members
      const { error: deleteError } = await supabase
        .from('facility_group_members')
        .delete()
        .eq('group_id', groupId);
      if (deleteError) throw deleteError;

      if (members.length > 0) {
        // Look up the non_metered_line_id for each (facility_id, input_type_id) pair
        const { data: lines } = await supabase
          .from('non_metered_lines')
          .select('id, facility_id, input_type_id')
          .eq('supplier_id', group.supplier_id)
          .in('facility_id', memberFacilityIds);

        const lineIds = members
          .map((m) =>
            (lines ?? []).find(
              (l) => String(l.facility_id) === String(m.facility_id) && String(l.input_type_id) === String(m.input_type_id)
            )?.id
          )
          .filter((id): id is string => id != null)
          .map(String);

        if (lineIds.length > 0) {
          const { error: insertError } = await supabase
            .from('facility_group_members')
            .insert(lineIds.map((lineId) => ({ group_id: groupId, non_metered_line_id: lineId })));
          if (insertError) throw insertError;
        }
      }
    }

    // Run backfill for the updated member set
    if (memberFacilityIds && memberFacilityIds.length > 0 && group.supplier_id) {
      await runGroupBackfill(supabase, group.supplier_id, memberFacilityIds);
    }

    const { data, error } = await supabase
      .from('facility_groups')
      .select(GROUP_SELECT)
      .eq('id', groupId)
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating facility group:', error);
    return NextResponse.json({ error: 'Failed to update facility group' }, { status: 500 });
  }
}

// DELETE /api/facility-groups/[id] — delete group (members cascade via DB)
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase
      .from('facility_groups')
      .delete()
      .eq('id', params.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting facility group:', error);
    return NextResponse.json({ error: 'Failed to delete facility group' }, { status: 500 });
  }
}
