export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/clients - List all clients with facility count
export async function GET() {
  try {
    // Fetch all clients with facilities in a single query
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('*, facilities(id)')
      .order('name');
    
    if (clientsError) throw clientsError;
    
    // Transform to include facilities count
    const clientsWithCounts = (clients || []).map(client => ({
      client: {
        id: client.id,
        name: client.name,
        logo_url: client.logo_url,
        created_at: client.created_at
      },
      facilitiesCount: client.facilities?.length || 0
    }));
    
    return NextResponse.json({ data: clientsWithCounts });
  } catch (error) {
    console.error('Error fetching clients:', error);
    return NextResponse.json(
      { data: [], error: 'Failed to fetch clients' },
      { status: 500 }
    );
  }
}

// POST /api/clients - Create new client
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name } = body;
    
    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'Client name is required' },
        { status: 400 }
      );
    }
    
    const { data, error } = await supabase
      .from('clients')
      .insert([{ name: name.trim() }])
      .select()
      .single();
    
    if (error) throw error;
    
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('Error creating client:', error);
    return NextResponse.json(
      { data: [], error: 'Failed to create client' },
      { status: 500 }
    );
  }
}