export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// POST /api/facility-groups/[id]/members — add a facility to the group
// Body: { facility_id: string }
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();
    const { facility_id } = body;

    if (!facility_id) {
      return NextResponse.json({ error: 'facility_id is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('facility_group_members')
      .insert([{ group_id: params.id, facility_id }])
      .select('*, facility:facilities(id, name)')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Facility is already a member of this group' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Error adding group member:', error);
    return NextResponse.json({ error: 'Failed to add facility to group' }, { status: 500 });
  }
}

// DELETE /api/facility-groups/[id]/members — remove a facility from the group
// Body: { facility_id: string }
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();
    const { facility_id } = body;

    if (!facility_id) {
      return NextResponse.json({ error: 'facility_id is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('facility_group_members')
      .delete()
      .eq('group_id', params.id)
      .eq('facility_id', facility_id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing group member:', error);
    return NextResponse.json({ error: 'Failed to remove facility from group' }, { status: 500 });
  }
}
