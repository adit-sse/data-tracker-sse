export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/clients - List all clients with facility count
export async function GET() {
  try {
    // Fetch all clients
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('*')
      .order('name');
    
    if (clientsError) throw clientsError;
    
    // For each client, count facilities
    const clientsWithCounts = await Promise.all(
      (clients || []).map(async (client) => {
        // Count facilities
        const { count: facilitiesCount } = await supabase
          .from('facilities')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', client.id);
        
        return {
          client,
          facilitiesCount: facilitiesCount || 0
        };
      })
    );
    
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