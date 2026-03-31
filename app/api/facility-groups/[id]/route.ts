export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { runGroupBackfill } from '@/lib/facility-group-backfill';

// PUT /api/facility-groups/[id] — update group name and/or members + run backfill
// Body: { name?: string, facility_ids?: string[] }
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const groupId = params.id;
    const body = await request.json();
    const { name, utility_category_id, facility_ids } = body;
    // facility_ids is { facility_id: string, utility_category_id: string }[]

    // Fetch group for supplier_id (needed for backfill)
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
    if (utility_category_id !== undefined) {
      groupUpdates.utility_category_id = utility_category_id || null;
    }
    if (Object.keys(groupUpdates).length > 0) {
      const { error: updateError } = await supabase
        .from('facility_groups')
        .update(groupUpdates)
        .eq('id', groupId);
      if (updateError) throw updateError;
    }

    let memberIds: string[] | null = null;

    if (Array.isArray(facility_ids)) {
      const members: { facility_id: string; utility_category_id: string }[] = facility_ids;
      memberIds = members.map((m) => m.facility_id);

      // Replace all members
      const { error: deleteError } = await supabase
        .from('facility_group_members')
        .delete()
        .eq('group_id', groupId);
      if (deleteError) throw deleteError;

      if (members.length > 0) {
        const { error: insertError } = await supabase
          .from('facility_group_members')
          .insert(members.map(({ facility_id, utility_category_id: ucid }) => ({
            group_id: groupId,
            facility_id,
            utility_category_id: ucid || null,
          })));
        if (insertError) throw insertError;
      }
    }

    // Run backfill for the updated member set
    if (memberIds && memberIds.length > 0 && group.supplier_id) {
      await runGroupBackfill(supabase, group.supplier_id, memberIds);
    }

    const { data, error } = await supabase
      .from('facility_groups')
      .select(`
        *,
        supplier:suppliers(id, name),
        utility_category:utility_categories(id, name),
        members:facility_group_members(
          id,
          facility_id,
          utility_category_id,
          facility:facilities(id, name),
          utility_category:utility_categories(id, name)
        )
      `)
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
