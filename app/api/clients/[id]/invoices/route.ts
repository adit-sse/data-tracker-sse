import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST /api/clients/[id]/invoices - Create new invoice manually
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const {
      meter_id,
      invoice_number,
      invoice_date,
      period_start_date,
      period_end_date,
      consumption,
      amount,
      framework,
      version,
      input_type,
      emissions_factor,
      customer
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

    // Prevent duplicate invoices:
    // 1) If an invoice_number is provided, ensure no existing invoice for the same meter has that invoice_number
    if (invoice_number && invoice_number.trim()) {
      const { data: existingByNumber, error: existingByNumberError } = await supabase
        .from('actual_invoices')
        .select('id')
        .eq('meter_id', meter_id)
        .eq('invoice_number', invoice_number.trim())
        .limit(1)
        .maybeSingle();

      if (existingByNumberError) {
        throw existingByNumberError;
      }

      if (existingByNumber) {
        return NextResponse.json(
          { error: 'An invoice with that invoice number already exists for this meter' },
          { status: 409 }
        );
      }
    }

    // 2) Prevent exact period duplicates for the same meter
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
        invoice_number: invoice_number?.trim() || null,
        invoice_date: invoice_date || null,
        period_start_date,
        period_end_date,
        consumption: consumption || null,
        amount: amount || null,
        framework: framework?.trim() || null,
        version: version?.trim() || null,
        input_type: input_type?.trim() || null,
        emissions_factor: emissions_factor || null,
        customer: customer?.trim() || null,
        status: 'MANUAL_ENTRY'
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
