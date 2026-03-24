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

    // Normalize optional fields: convert empty strings/undefined to null, but preserve numeric 0
    const invoiceNumberTrimmed = invoice_number?.toString().trim() || null;
    const invoiceDateValue = invoice_date ? invoice_date.toString() : null;
    const consumptionValue = consumption == null ? null : consumption; // allows 0
    const amountValue = amount == null ? null : amount; // allows 0
    const customerValue = customer?.toString().trim() || null;
    
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
    // 1) If an invoice number is provided (non-empty after trimming), check duplicate by invoice number for the meter
    if (invoiceNumberTrimmed) {
      const { data: existingByNumber, error: existingByNumberError } = await supabase
        .from('actual_invoices')
        .select('id')
        .eq('meter_id', meter_id)
        .eq('invoice_number', invoiceNumberTrimmed)
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

    // 2) Always prevent exact period duplicates for the same meter (applies regardless of invoice number)
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
        invoice_number: invoiceNumberTrimmed,
        invoice_date: invoiceDateValue,
        period_start_date,
        period_end_date,
        consumption: consumptionValue,
        amount: amountValue,
        framework: framework?.trim() || null,
        version: version?.trim() || null,
        input_type: input_type?.trim() || null,
        emissions_factor: emissions_factor ?? null,
        customer: customerValue,
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
