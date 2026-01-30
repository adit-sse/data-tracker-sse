export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/clients/[id] - Get client details
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
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

// DELETE /api/clients/[id] - Delete a client and cascade delete related data
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    // Attempt to delete the client row; DB schema uses ON DELETE CASCADE for related rows
    const { data, error } = await supabase
      .from('clients')
      .delete()
      .eq('id', params.id)
      .select()
      .single();

    if (error) throw error;

    if (!data) {
      return NextResponse.json(
        { error: 'Client not found' },
        { status: 404 }
      );
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
