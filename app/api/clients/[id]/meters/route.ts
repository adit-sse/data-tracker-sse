import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/clients/[id]/meters - Get all meters for a client
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const clientId = parseInt(params.id); // Convert to integer!
    console.log('Fetching meters for client:', clientId, '(type:', typeof clientId, ')');
    
    // Get all facilities for this client
    const { data: facilities, error: facilitiesError } = await supabase
      .from('facilities')
      .select('id')
      .eq('client_id', clientId); // Use integer version
    
    if (facilitiesError) {
      console.error('Error fetching facilities:', facilitiesError);
      throw facilitiesError;
    }
    
    console.log('Found facilities:', facilities);
    
    const facilityIds = facilities?.map(f => f.id) || [];
    
    if (facilityIds.length === 0) {
      console.log('No facilities found for this client');
      return NextResponse.json([]);
    }
    
    // Get all meters for these facilities
    const { data: meters, error: metersError } = await supabase
      .from('meters')
      .select(`
        *,
        facility:facilities(id, name),
        supplier:suppliers(id, name),
        utility_category:utility_categories(id, name)
      `)
      .in('facility_id', facilityIds)
      .order('facility_id');
    
    if (metersError) {
      console.error('Error fetching meters:', metersError);
      throw metersError;
    }
    
    console.log('Found meters:', meters?.length || 0, meters);
    
    return NextResponse.json(meters || []);
  } catch (error) {
    console.error('Error in GET /api/clients/[id]/meters:', error);
    return NextResponse.json(
      { error: 'Failed to fetch meters' },
      { status: 500 }
    );
  }
}
