export const dynamic = 'force-dynamic';
export const revalidate = 0;


import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// POST /api/clients/[id]/invoices - Create new invoice manually
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();
    const {
      meter_id,
      period_start_date,
      period_end_date,
    } = body;

    if (!meter_id || !period_start_date || !period_end_date) {
      return NextResponse.json(
        { error: 'Missing required fields: meter_id, period_start_date, period_end_date' },
        { status: 400 }
      );
    }
    
    // Validate dates
    const startDate = new Date(period_start_date);
    const endDate = new Date(period_end_date);
    
    if (endDate < startDate) {
      return NextResponse.json(
        { error: 'End date must be after or equal to start date' },
        { status: 400 }
      );
    }

    // Prevent exact period duplicates for the same meter
    const { data: existingByPeriod, error: existingByPeriodError } = await supabase
      .from('actual_invoices')
      .select('id')
      .eq('meter_id', meter_id)
      .eq('period_start_date', period_start_date)
      .eq('period_end_date', period_end_date)
      .limit(1)
      .maybeSingle();

    if (existingByPeriodError) {
      throw existingByPeriodError;
    }

    if (existingByPeriod) {
      return NextResponse.json(
        { error: 'An invoice for this meter with the same period already exists' },
        { status: 409 }
      );
    }

    const { data, error } = await supabase
      .from('actual_invoices')
      .insert([{
        meter_id,
        period_start_date,
        period_end_date,
        status: 'CONFIRMED'
      }])
      .select()
      .single();
    
    if (error) throw error;
    
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Error creating invoice:', error);
    return NextResponse.json(
      { error: 'Failed to create invoice' },
      { status: 500 }
    );
  }
}
