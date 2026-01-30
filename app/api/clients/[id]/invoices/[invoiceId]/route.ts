export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// PATCH /api/clients/[id]/invoices/[invoiceId] - Update invoice
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; invoiceId: string } }
) {
  try {
    const body = await request.json();
    const { invoiceId } = params;
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

    if (!invoiceId) {
      return NextResponse.json({ error: 'Missing invoice id parameter' }, { status: 400 });
    }

    // Validate dates if provided
    if (period_start_date && period_end_date) {
      const startDate = new Date(period_start_date);
      const endDate = new Date(period_end_date);
      if (endDate < startDate) {
        return NextResponse.json({ error: 'End date must be after or equal to start date' }, { status: 400 });
      }
    }

    // Check for invoice number duplicates for the same meter (exclude current invoice)
    const invoiceNumberTrimmed = invoice_number?.toString().trim() || null;
    if (invoiceNumberTrimmed && meter_id) {
      const { data: existingByNumber, error: existingByNumberError } = await supabase
        .from('actual_invoices')
        .select('id')
        .eq('meter_id', meter_id)
        .eq('invoice_number', invoiceNumberTrimmed)
        .neq('id', invoiceId)
        .limit(1)
        .maybeSingle();

      if (existingByNumberError) throw existingByNumberError;
      if (existingByNumber) {
        return NextResponse.json({ error: 'An invoice with that invoice number already exists for this meter' }, { status: 409 });
      }
    }

    // Prevent exact period duplicates for the same meter (exclude current invoice)
    if (meter_id && period_start_date && period_end_date) {
      const { data: existingByPeriod, error: existingByPeriodError } = await supabase
        .from('actual_invoices')
        .select('id')
        .eq('meter_id', meter_id)
        .eq('period_start_date', period_start_date)
        .eq('period_end_date', period_end_date)
        .neq('id', invoiceId)
        .limit(1)
        .maybeSingle();

      if (existingByPeriodError) throw existingByPeriodError;
      if (existingByPeriod) {
        return NextResponse.json({ error: 'An invoice for this meter with the same period already exists' }, { status: 409 });
      }
    }

    // Build update payload: keep fields if provided, convert empty strings to null where appropriate
    const payload: any = {};
    if (meter_id) payload.meter_id = meter_id;
    if (invoice_number !== undefined) payload.invoice_number = invoiceNumberTrimmed;
    if (invoice_date !== undefined) payload.invoice_date = invoice_date ? invoice_date.toString() : null;
    if (period_start_date !== undefined) payload.period_start_date = period_start_date;
    if (period_end_date !== undefined) payload.period_end_date = period_end_date;
    if (consumption !== undefined) payload.consumption = consumption == null ? null : consumption;
    if (amount !== undefined) payload.amount = amount == null ? null : amount;
    if (framework !== undefined) payload.framework = framework?.trim() || null;
    if (version !== undefined) payload.version = version?.trim() || null;
    if (input_type !== undefined) payload.input_type = input_type?.trim() || null;
    if (emissions_factor !== undefined) payload.emissions_factor = emissions_factor ?? null;
    if (customer !== undefined) payload.customer = customer?.toString().trim() || null;

    const { data, error } = await supabase
      .from('actual_invoices')
      .update(payload)
      .eq('id', invoiceId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error('Error updating invoice:', error);
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/invoices/[invoiceId] - Delete invoice
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; invoiceId: string } }
) {
  try {
    const { invoiceId } = params;
    if (!invoiceId) {
      return NextResponse.json({ error: 'Missing invoice id parameter' }, { status: 400 });
    }

    const { error } = await supabase
      .from('actual_invoices')
      .delete()
      .eq('id', invoiceId);

    if (error) throw error;

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    return NextResponse.json({ error: 'Failed to delete invoice' }, { status: 500 });
  }
}