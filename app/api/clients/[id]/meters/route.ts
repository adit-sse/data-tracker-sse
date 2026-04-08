export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// GET /api/clients/[id]/meters - Get all meters for a client
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const clientId = params.id;
    
    // Get all facilities for this client
    const { data: facilities, error: facilitiesError } = await supabase
      .from('facilities')
      .select('id')
      .eq('client_id', clientId);
    
    if (facilitiesError) {
      console.error('Error fetching facilities:', facilitiesError);
      throw facilitiesError;
    }
    
    const facilityIds = facilities?.map(f => f.id) || [];
    
    if (facilityIds.length === 0) {
      return NextResponse.json([]);
    }
    
    // Get all meters for these facilities
    const { data: meters, error: metersError } = await supabase
      .from('meters')
      .select(`
        *,
        facility:facilities(id, name),
        supplier:suppliers(id, name),
        input_type:input_types(id, name),
        category:categories(id, name)
      `)
      .in('facility_id', facilityIds)
      .order('facility_id');
    
    if (metersError) throw metersError;
    
    return NextResponse.json(meters || []);
  } catch (error) {
    console.error('Error in GET /api/clients/[id]/meters:', error);
    return NextResponse.json(
      { error: 'Failed to fetch meters' },
      { status: 500 }
    );
  }
}
