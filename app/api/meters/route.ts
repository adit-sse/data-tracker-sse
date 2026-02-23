export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST /api/meters - Create new meter
export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('Received meter data:', body);
    
    const { facility_id, supplier_id, utility_category_id, identifier_type, lookup1, lookup2, in_service_start_date, in_service_end_date } = body;
    
    // Supplier is now optional
    if (!facility_id || !utility_category_id || !identifier_type || !lookup1) {
      console.error('Missing required fields:', { facility_id, utility_category_id, identifier_type, lookup1 });
      return NextResponse.json(
        { error: 'Missing required fields: facility_id, utility_category_id, identifier_type, lookup1' },
        { status: 400 }
      );
    }
    
    // Check if meter already exists
    const { data: existing, error: checkError } = await supabase
      .from('meters')
      .select('*')
      .eq('facility_id', facility_id)
      .eq('utility_category_id', utility_category_id)
      .eq('identifier_type', identifier_type)
      .eq('lookup1', lookup1)
      .single();
    
    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Error checking for existing meter:', checkError);
    }
    
    if (existing) {
      console.log('Meter already exists:', existing);
      return NextResponse.json(
        { error: 'Meter with this identifier already exists for this facility' },
        { status: 409 }
      );
    }
    
    console.log('Creating new meter...');
    const { data, error } = await supabase
      .from('meters')
      .insert([{
        facility_id,
        supplier_id: supplier_id || null,  // Allow null if no supplier
        utility_category_id,
        identifier_type,
        lookup1: lookup1.trim(),
        lookup2: lookup2?.trim() || null,
        in_service_start_date: in_service_start_date || null,
        in_service_end_date: in_service_end_date || null
      }])
      .select()
      .single();
    
    if (error) {
      console.error('Supabase error creating meter:', error);
      throw error;
    }
    
    console.log('Meter created successfully:', data);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Error creating meter:', error);
    return NextResponse.json(
      { error: 'Failed to create meter', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
