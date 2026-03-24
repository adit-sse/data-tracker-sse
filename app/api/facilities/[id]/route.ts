export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// PUT /api/facilities/[id] - Update facility
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
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
    const supabase = createSupabaseServerClient();
    // First, get all meter IDs for this facility
    const { data: meters, error: fetchMetersError } = await supabase
      .from('meters')
      .select('id')
      .eq('facility_id', params.id);
    
    if (fetchMetersError) throw fetchMetersError;
    
    // Delete invoices for all meters in this facility
    if (meters && meters.length > 0) {
      const meterIds = meters.map(m => m.id);
      const { error: invoicesError } = await supabase
        .from('actual_invoices')
        .delete()
        .in('meter_id', meterIds);
      
      if (invoicesError) throw invoicesError;
    }
    
    // Delete all meters for this facility
    const { error: metersError } = await supabase
      .from('meters')
      .delete()
      .eq('facility_id', params.id);
    
    if (metersError) throw metersError;
    
    // Finally delete the facility
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
