export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { runGroupBackfill } from '@/lib/facility-group-backfill';
import {
  normalizeGroupMembers,
  resolveMemberLineIds,
} from '@/lib/facility-group-members';

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
      input_type:input_types(id, name),
      supplier:suppliers(id, name)
    )
  )
`;

// PUT /api/facility-groups/[id] — update group name, supplier, category, members + run backfill
// Body: { name?: string, supplier_id?: string, category_id?: string,
//         members?: { facility_id, input_type_id, supplier_id? }[],
//         facility_ids?: { facility_id, input_type_id }[] (legacy) }
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const groupId = params.id;
    const body = await request.json();
    const { name, supplier_id, category_id, facility_ids } = body;

    const { data: group, error: groupFetchError } = await supabase
      .from('facility_groups')
      .select('supplier_id')
      .eq('id', groupId)
      .single();

    if (groupFetchError) throw groupFetchError;

    const effectiveSupplierId = supplier_id ?? group.supplier_id;

    const groupUpdates: Record<string, unknown> = {};
    if (name !== undefined) {
      if (!name?.trim()) {
        return NextResponse.json({ error: 'Group name cannot be empty' }, { status: 400 });
      }
      groupUpdates.name = name.trim();
    }
    if (supplier_id !== undefined) {
      if (!supplier_id) {
        return NextResponse.json({ error: 'supplier_id cannot be empty' }, { status: 400 });
      }
      groupUpdates.supplier_id = supplier_id;
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
    const hasMemberPayload = Array.isArray(body.members) || Array.isArray(facility_ids);

    if (hasMemberPayload) {
      const members = normalizeGroupMembers(
        { facility_ids, members: body.members },
        String(effectiveSupplierId)
      );
      memberFacilityIds = [...new Set(members.map((m) => m.facility_id))];

      const { error: deleteError } = await supabase
        .from('facility_group_members')
        .delete()
        .eq('group_id', groupId);
      if (deleteError) throw deleteError;

      if (members.length > 0) {
        const resolvedCategoryId =
          category_id !== undefined ? category_id || null : undefined;
        const lineIds = await resolveMemberLineIds(
          supabase,
          members,
          resolvedCategoryId
        );

        if (lineIds.length > 0) {
          const { error: insertError } = await supabase
            .from('facility_group_members')
            .insert(lineIds.map((lineId) => ({ group_id: groupId, non_metered_line_id: lineId })));
          if (insertError) throw insertError;
        }
      }
    }

    if (memberFacilityIds && memberFacilityIds.length > 0 && effectiveSupplierId) {
      await runGroupBackfill(supabase, effectiveSupplierId, memberFacilityIds, groupId);
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
