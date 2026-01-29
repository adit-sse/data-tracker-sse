import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { calculateCurrentMonthCoverageForClient } from '@/lib/coverage';

// GET /api/clients - List all clients with current month coverage
export async function GET() {
  try {
    // Fetch all clients
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('*')
      .order('name');
    
    if (clientsError) throw clientsError;
    
    // For each client, get stats
    const clientsWithStats = await Promise.all(
      (clients || []).map(async (client) => {
        // Count facilities
        const { count: facilitiesCount } = await supabase
          .from('facilities')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', client.id);
        
        // Get all meters for this client
        const { data: facilities } = await supabase
          .from('facilities')
          .select('id')
          .eq('client_id', client.id);
        
        const facilityIds = facilities?.map(f => f.id) || [];
        
        let currentMonthCoverage = {
          month: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          daysCovered: 0,
          totalPossibleDays: 0,
          percentage: 0
        };
        
        if (facilityIds.length > 0) {
          // Get all meters
          const { data: meters } = await supabase
            .from('meters')
            .select('id')
            .in('facility_id', facilityIds);
          
          const meterIds = meters?.map(m => m.id) || [];
          
          if (meterIds.length > 0) {
            // Get all invoices for current month
            const { data: invoices } = await supabase
              .from('actual_invoices')
              .select('*')
              .in('meter_id', meterIds);
            
            currentMonthCoverage = calculateCurrentMonthCoverageForClient(
              invoices || [],
              meterIds.length
            );
          }
        }
        
        return {
          client,
          facilitiesCount: facilitiesCount || 0,
          currentMonthCoverage
        };
      })
    );
    
    return NextResponse.json(clientsWithStats);
  } catch (error) {
    console.error('Error fetching clients:', error);
    return NextResponse.json(
      { error: 'Failed to fetch clients' },
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
    
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Error creating client:', error);
    return NextResponse.json(
      { error: 'Failed to create client' },
      { status: 500 }
    );
  }
}
