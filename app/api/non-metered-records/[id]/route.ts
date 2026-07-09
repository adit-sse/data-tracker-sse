export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// PATCH /api/non-metered-records/[id] - Update a non-metered record (e.g. mark as received)
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();
    const allowed = ['status'];

    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('non_metered_records')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating non-metered record:', error);
    return NextResponse.json({ error: 'Failed to update record' }, { status: 500 });
  }
}

// DELETE /api/non-metered-records/[id] - Remove a manually-set or inferred-empty record
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase
      .from('non_metered_records')
      .delete()
      .eq('id', params.id);

    if (error) throw error;

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Error deleting non-metered record:', error);
    return NextResponse.json({ error: 'Failed to delete record' }, { status: 500 });
  }
}
