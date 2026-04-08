export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// PUT /api/input-types/[id] - Update an input type
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();
    const { name, scope, is_metered, needs_review } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (scope !== undefined && ![1, 2, 3].includes(Number(scope))) {
      return NextResponse.json({ error: 'scope must be 1, 2, or 3' }, { status: 400 });
    }

    const payload: Record<string, unknown> = { name: name.trim() };
    if (scope !== undefined) payload.scope = Number(scope);
    if (is_metered !== undefined) payload.is_metered = Boolean(is_metered);
    if (needs_review !== undefined) payload.needs_review = Boolean(needs_review);

    const { data, error } = await supabase
      .from('input_types')
      .update(payload)
      .eq('id', params.id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating input type:', error);
    return NextResponse.json({ error: 'Failed to update input type' }, { status: 500 });
  }
}

// DELETE /api/input-types/[id] - Delete an input type
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.from('input_types').delete().eq('id', params.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting input type:', error);
    return NextResponse.json({ error: 'Failed to delete input type' }, { status: 500 });
  }
}
