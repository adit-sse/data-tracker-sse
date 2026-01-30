export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// PUT /api/facilities/[id] - Update facility
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { name, address } = body;
    
    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'Facility name is required' },
        { status: 400 }
      );
    }
    
    const { data, error } = await supabase
      .from('facilities')
      .update({
        name: name.trim(),
        address: address?.trim() || null
      })
      .eq('id', params.id)
      .select()
      .single();
    
    if (error) throw error;
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating facility:', error);
    return NextResponse.json(
      { error: 'Failed to update facility' },
      { status: 500 }
    );
  }
}

// DELETE /api/facilities/[id] - Delete facility
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    // First, delete all meters for this facility (which will cascade to invoices)
    const { error: metersError } = await supabase
      .from('meters')
      .delete()
      .eq('facility_id', params.id);
    
    if (metersError) throw metersError;
    
    // Then delete the facility
    const { error: facilityError } = await supabase
      .from('facilities')
      .delete()
      .eq('id', params.id);
    
    if (facilityError) throw facilityError;
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting facility:', error);
    return NextResponse.json(
      { error: 'Failed to delete facility' },
      { status: 500 }
    );
  }
}
