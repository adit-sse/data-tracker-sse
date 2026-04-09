export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// GET /api/clients - List all clients with facility count
export async function GET() {
  try {
    const supabase = createSupabaseServerClient();

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, facilities(id)')
      .order('name');

    if (clientsError) throw clientsError;

    const clientsWithCounts = (clients || []).map(client => ({
      client: { id: client.id, name: client.name },
      facilitiesCount: (client.facilities || []).length,
    }));

    return NextResponse.json({ data: clientsWithCounts }, {
      headers: {
        // Browser-only cache (private = not shared with CDN/proxy, safe for auth'd data).
        // Serve from cache instantly for 30s; between 30–90s serve stale while refreshing in background.
        'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
      },
    });
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
    const supabase = createSupabaseServerClient();
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