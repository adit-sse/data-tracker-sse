export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// GET /api/clients/[id] - Get client details
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', params.id)
      .single();
    
    if (error) throw error;
    
    if (!data) {
      return NextResponse.json(
        { error: 'Client not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching client:', error);
    return NextResponse.json(
      { error: 'Failed to fetch client' },
      { status: 500 }
    );
  }
}

// PUT /api/clients/[id] - Update client
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();
    const { name, logo_url } = body;
    
    const updates: any = {};
    if (name !== undefined) updates.name = name.trim();
    if (logo_url !== undefined) updates.logo_url = logo_url;
    
    const { data, error } = await supabase
      .from('clients')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single();
    
    if (error) throw error;
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating client:', error);
    return NextResponse.json(
      { error: 'Failed to update client' },
      { status: 500 }
    );
  }
}

// DELETE /api/clients/[id] - Delete a client with full manual cascade
// (DB-level ON DELETE CASCADE is not relied upon)
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const clientId = params.id;

  try {
    const supabase = createSupabaseServerClient();
    // 1. Get all facility IDs for this client
    const { data: facilities, error: facilitiesError } = await supabase
      .from('facilities')
      .select('id')
      .eq('client_id', clientId);

    if (facilitiesError) throw facilitiesError;

    const facilityIds = (facilities || []).map((f: any) => f.id);

    if (facilityIds.length > 0) {
      // 2. Get all meter IDs for these facilities
      const { data: meters, error: metersError } = await supabase
        .from('meters')
        .select('id')
        .in('facility_id', facilityIds);

      if (metersError) throw metersError;

      const meterIds = (meters || []).map((m: any) => m.id);

      // 3. Delete actual_invoices for all meters
      if (meterIds.length > 0) {
        const { error: invoicesError } = await supabase
          .from('actual_invoices')
          .delete()
          .in('meter_id', meterIds);
        if (invoicesError) throw invoicesError;
      }

      // 4. Delete meters for all facilities
      const { error: deleteMetersError } = await supabase
        .from('meters')
        .delete()
        .in('facility_id', facilityIds);
      if (deleteMetersError) throw deleteMetersError;

      // 5. Delete non_metered_records for all facilities
      const { error: nmError } = await supabase
        .from('non_metered_records')
        .delete()
        .in('facility_id', facilityIds);
      // Ignore error if table doesn't exist yet (migration not yet run)
      if (nmError && !nmError.message?.includes('does not exist')) throw nmError;

      // 6. Delete facility_group_members for all facilities
      const { error: fgmError } = await supabase
        .from('facility_group_members')
        .delete()
        .in('facility_id', facilityIds);
      if (fgmError && !fgmError.message?.includes('does not exist')) throw fgmError;
    }

    // 7. Delete facility_groups for this client
    const { error: fgError } = await supabase
      .from('facility_groups')
      .delete()
      .eq('client_id', clientId);
    if (fgError && !fgError.message?.includes('does not exist')) throw fgError;

    // 8. Delete all facilities for this client
    const { error: deleteFacilitiesError } = await supabase
      .from('facilities')
      .delete()
      .eq('client_id', clientId);
    if (deleteFacilitiesError) throw deleteFacilitiesError;

    // 9. Delete the client itself
    const { data, error: deleteClientError } = await supabase
      .from('clients')
      .delete()
      .eq('id', clientId)
      .select()
      .single();

    if (deleteClientError) throw deleteClientError;

    if (!data) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting client:', error);
    return NextResponse.json(
      { error: 'Failed to delete client' },
      { status: 500 }
    );
  }
}
