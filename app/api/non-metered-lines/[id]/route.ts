export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { deleteNonMeteredLine } from '@/lib/delete-non-metered-line';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string) {
  return UUID_RE.test(value);
}

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
      const raw = body.category_id;
      if (raw === null || raw === '') {
        updateData.category_id = null;
      } else if (typeof raw === 'string') {
        if (!isUuid(raw)) {
          return NextResponse.json(
            { error: 'category_id must be a category UUID' },
            { status: 400 }
          );
        }
        updateData.category_id = raw;
      }
    }

    if (body.input_type_id !== undefined && typeof body.input_type_id === 'string') {
      if (!isUuid(body.input_type_id)) {
        return NextResponse.json(
          { error: 'input_type_id must be a UUID' },
          { status: 400 }
        );
      }
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

// DELETE /api/non-metered-lines/[id] - Delete a line, its records, and group memberships
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const result = await deleteNonMeteredLine(supabase, params.id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Error deleting non-metered line:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete non-metered line';
    const status = message === 'Line not found' ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
