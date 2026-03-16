export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { runGroupBackfill } from '@/lib/facility-group-backfill';

// PUT /api/facility-groups/[id] — update group name and/or members + run backfill
// Body: { name?: string, facility_ids?: string[] }
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const groupId = params.id;
    const body = await request.json();
    const { name, facility_ids } = body;

    // Fetch group for supplier_id (needed for backfill)
    const { data: group, error: groupFetchError } = await supabase
      .from('facility_groups')
      .select('supplier_id')
      .eq('id', groupId)
      .single();

    if (groupFetchError) throw groupFetchError;

    if (name !== undefined) {
      if (!name?.trim()) {
        return NextResponse.json({ error: 'Group name cannot be empty' }, { status: 400 });
      }
      const { error: nameError } = await supabase
        .from('facility_groups')
        .update({ name: name.trim() })
        .eq('id', groupId);
      if (nameError) throw nameError;
    }

    let memberIds: string[] | null = null;

    if (Array.isArray(facility_ids)) {
      memberIds = facility_ids;

      // Replace all members
      const { error: deleteError } = await supabase
        .from('facility_group_members')
        .delete()
        .eq('group_id', groupId);
      if (deleteError) throw deleteError;

      if (memberIds.length > 0) {
        const { error: insertError } = await supabase
          .from('facility_group_members')
          .insert(memberIds.map((fid) => ({ group_id: groupId, facility_id: fid })));
        if (insertError) throw insertError;
      }
    }

    // Run backfill for the updated member set
    if (memberIds && memberIds.length > 0 && group.supplier_id) {
      await runGroupBackfill(group.supplier_id, memberIds);
    }

    const { data, error } = await supabase
      .from('facility_groups')
      .select(`
        *,
        supplier:suppliers(id, name),
        members:facility_group_members(
          id,
          facility_id,
          facility:facilities(id, name)
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
