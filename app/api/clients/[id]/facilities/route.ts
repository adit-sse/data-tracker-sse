export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/clients/[id]/facilities - Get facilities for a client
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const clientId = parseInt(params.id);
    
    const { data, error } = await supabase
      .from('facilities')
      .select('*')
      .eq('client_id', clientId)
      .order('name');
    
    if (error) throw error;
    
    // Get meter count for each facility
    const facilitiesWithCounts = await Promise.all(
      (data || []).map(async (facility) => {
        const { count } = await supabase
          .from('meters')
          .select('*', { count: 'exact', head: true })
          .eq('facility_id', facility.id);
        
        return {
          ...facility,
          meterCount: count || 0
        };
      })
    );
    
    return NextResponse.json(facilitiesWithCounts);
  } catch (error) {
    console.error('Error fetching facilities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch facilities' },
      { status: 500 }
    );
  }
}

// POST /api/clients/[id]/facilities - Create new facility
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const clientId = parseInt(params.id); // Convert to integer!
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
      .insert([{
        client_id: clientId, // Use integer version
        name: name.trim(),
        address: address?.trim() || null
      }])
      .select()
      .single();
    
    if (error) throw error;
    
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Error creating facility:', error);
    return NextResponse.json(
      { error: 'Failed to create facility' },
      { status: 500 }
    );
  }
}
