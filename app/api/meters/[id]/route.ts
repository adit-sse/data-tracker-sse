export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { IDENTIFIER_TYPES } from '@/types';

// PATCH /api/meters/[id] - Update a meter
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();
    const {
      facility_id,
      input_type_id,
      category_id,
      identifier_type,
      lookup1,
      lookup2,
      supplier_id,
      in_service_start_date,
      in_service_end_date,
      needs_attention
    } = body;

    const updateData: Record<string, unknown> = {};

    if (facility_id !== undefined) {
      updateData.facility_id = facility_id;
    }
    if (input_type_id !== undefined) {
      updateData.input_type_id = input_type_id;
    }
    if ('category_id' in body) {
      updateData.category_id = category_id || null;
    }
    if (identifier_type !== undefined) {
      // Whitelisted here so a bad value is a 400 rather than a CHECK-constraint 500.
      if (!IDENTIFIER_TYPES.some((t) => t.value === identifier_type)) {
        return NextResponse.json(
          { error: `Invalid identifier type "${identifier_type}"` },
          { status: 400 }
        );
      }
      updateData.identifier_type = identifier_type;
    }
    if (lookup1 !== undefined) {
      // POST rejects a blank identifier; PATCH must too, or an edit can clear it.
      const trimmed = typeof lookup1 === 'string' ? lookup1.trim() : String(lookup1 ?? '').trim();
      if (!trimmed) {
        return NextResponse.json(
          { error: 'Identifier cannot be empty' },
          { status: 400 }
        );
      }
      updateData.lookup1 = trimmed;
    }
    if (lookup2 !== undefined) {
      updateData.lookup2 = lookup2?.trim() || null;
    }
    if (supplier_id !== undefined) {
      updateData.supplier_id = supplier_id || null;
    }
    if (in_service_start_date !== undefined) {
      updateData.in_service_start_date = in_service_start_date || null;
    }
    if (in_service_end_date !== undefined) {
      updateData.in_service_end_date = in_service_end_date || null;
    }
    if (needs_attention !== undefined) {
      updateData.needs_attention = !!needs_attention;
    }
    if (body.is_active !== undefined && typeof body.is_active === 'boolean') {
      updateData.is_active = body.is_active;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('meters')
      .update(updateData)
      .eq('id', params.id)
      .select()
      .single();

    if (error) {
      // meters is UNIQUE (facility_id, input_type_id, identifier_type, lookup1),
      // so editing facility, input type, or identifier can collide with an existing meter.
      if (error.code === '23505') {
        return NextResponse.json(
          {
            error:
              'Another meter on this facility already uses that input type and identifier. ' +
              'Change the identifier, or edit the existing meter instead.',
          },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating meter:', error);
    return NextResponse.json(
      { error: 'Failed to update meter' },
      { status: 500 }
    );
  }
}

// DELETE /api/meters/[id] - Delete a meter and its invoices
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    // Delete invoices for this meter
    const { error: invoicesError } = await supabase
      .from('actual_invoices')
      .delete()
      .eq('meter_id', params.id);

    if (invoicesError) throw invoicesError;

    // Delete the meter
    const { error: meterError } = await supabase
      .from('meters')
      .delete()
      .eq('id', params.id);

    if (meterError) throw meterError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting meter:', error);
    return NextResponse.json(
      { error: 'Failed to delete meter' },
      { status: 500 }
    );
  }
}
