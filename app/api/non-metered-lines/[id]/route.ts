export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// PATCH /api/non-metered-lines/[id] - Update a non-metered line
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();

    const updateData: Record<string, unknown> = {};

    if (body.is_active !== undefined && typeof body.is_active === 'boolean') {
      updateData.is_active = body.is_active;
    }

    if ('category_id' in body) {
      updateData.category_id = body.category_id || null;
    }

    if (body.input_type_id !== undefined && typeof body.input_type_id === 'string') {
      updateData.input_type_id = body.input_type_id;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('non_metered_lines')
      .update(updateData)
      .eq('id', params.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating non-metered line:', error);
    return NextResponse.json(
      { error: 'Failed to update non-metered line' },
      { status: 500 }
    );
  }
}
