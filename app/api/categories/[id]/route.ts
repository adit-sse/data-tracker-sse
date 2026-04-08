export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// PUT /api/categories/[id] - Update a category
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();
    const { name, scope } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (scope !== undefined && ![1, 3].includes(Number(scope))) {
      return NextResponse.json({ error: 'scope must be 1 or 3' }, { status: 400 });
    }

    const payload: Record<string, unknown> = { name: name.trim() };
    if (scope !== undefined) payload.scope = Number(scope);

    const { data, error } = await supabase
      .from('categories')
      .update(payload)
      .eq('id', params.id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating category:', error);
    return NextResponse.json({ error: 'Failed to update category' }, { status: 500 });
  }
}

// DELETE /api/categories/[id] - Delete a category
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.from('categories').delete().eq('id', params.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting category:', error);
    return NextResponse.json({ error: 'Failed to delete category' }, { status: 500 });
  }
}
