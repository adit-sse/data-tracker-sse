export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// PATCH /api/meters/[id] - Update a meter
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { 
      facility_id,
      utility_category_id,
      identifier_type,
      lookup1,
      lookup2,
      supplier_id,
      in_service_start_date, 
      in_service_end_date 
    } = body;

    const updateData: Record<string, unknown> = {};
    
    if (facility_id !== undefined) {
      updateData.facility_id = facility_id;
    }
    if (utility_category_id !== undefined) {
      updateData.utility_category_id = utility_category_id;
    }
    if (identifier_type !== undefined) {
      updateData.identifier_type = identifier_type;
    }
    if (lookup1 !== undefined) {
      updateData.lookup1 = lookup1?.trim();
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

    if (error) throw error;

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
