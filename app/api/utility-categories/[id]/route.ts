export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// PUT /api/utility-categories/:id — update category
// Accepts: name, scope, is_metered, needs_review
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const body = await request.json();
    const { name, scope, is_metered, needs_review } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Category name is required' }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = { name: name.trim() };

    if (scope !== undefined) {
      if (![1, 2, 3].includes(Number(scope))) {
        return NextResponse.json({ error: 'scope must be 1, 2, or 3' }, { status: 400 });
      }
      updatePayload.scope = Number(scope);
    }

    if (is_metered !== undefined) {
      updatePayload.is_metered = Boolean(is_metered);
    }

    if (needs_review !== undefined) {
      updatePayload.needs_review = Boolean(needs_review);
    }

    const { data, error } = await supabase
      .from('utility_categories')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating utility category:', error);
    return NextResponse.json({ error: 'Failed to update utility category' }, { status: 500 });
  }
}

// DELETE /api/utility-categories/:id — delete category
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { error } = await supabase.from('utility_categories').delete().eq('id', params.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting utility category:', error);
    return NextResponse.json({ error: 'Failed to delete utility category' }, { status: 500 });
  }
}
