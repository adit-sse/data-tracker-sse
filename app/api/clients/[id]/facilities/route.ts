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
    const clientId = params.id;
    
    // Get facilities with meter count in a single query using left join
    const { data: facilities, error } = await supabase
      .from('facilities')
      .select('*, meters(id)')
      .eq('client_id', clientId)
      .order('name');
    
    if (error) throw error;
    
    // Transform to include meter count
    const facilitiesWithCounts = (facilities || []).map(facility => ({
      id: facility.id,
      client_id: facility.client_id,
      name: facility.name,
      address: facility.address,
      created_at: facility.created_at,
      meterCount: facility.meters?.length || 0
    }));
    
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
    const clientId = params.id;
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
        client_id: clientId,
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
