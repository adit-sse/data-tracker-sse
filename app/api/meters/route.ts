export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// POST /api/meters - Create new meter
export async function POST(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();
    
    const { facility_id, supplier_id, utility_category_id, identifier_type, lookup1, lookup2, in_service_start_date, in_service_end_date } = body;
    
    // Supplier is now optional
    if (!facility_id || !utility_category_id || !identifier_type || !lookup1) {
      return NextResponse.json(
        { error: 'Missing required fields: facility_id, utility_category_id, identifier_type, lookup1' },
        { status: 400 }
      );
    }
    
    // Try to insert - let database handle uniqueness constraint
    const { data, error } = await supabase
      .from('meters')
      .insert([{
        facility_id,
        supplier_id: supplier_id || null,
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
      // Check if it's a unique constraint violation
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Meter with this identifier already exists for this facility' },
          { status: 409 }
        );
      }
      throw error;
    }
    
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Error creating meter:', error);
    return NextResponse.json(
      { error: 'Failed to create meter', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
