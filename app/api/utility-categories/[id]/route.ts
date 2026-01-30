export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// PUT /api/utility-categories/:id - Update category
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const body = await request.json();
    const { name } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Category name is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('utility_categories')
      .update({ name: name.trim() })
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

// DELETE /api/utility-categories/:id - Delete category
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;

    const { error } = await supabase.from('utility_categories').delete().eq('id', id);
    if (error) {
      console.error('Error deleting utility category:', error);
      return NextResponse.json({ error: 'Failed to delete utility category' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting utility category:', error);
    return NextResponse.json({ error: 'Failed to delete utility category' }, { status: 500 });
  }
}
