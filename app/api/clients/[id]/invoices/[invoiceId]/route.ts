export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

interface InvoiceUpdatePayload {
  meter_id?: string;
  period_start_date?: string;
  period_end_date?: string;
}

// PATCH /api/clients/[id]/invoices/[invoiceId] - Update invoice
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; invoiceId: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();
    const { invoiceId } = params;
    const {
      meter_id,
      period_start_date,
      period_end_date,
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

    // Build update payload
    const payload: InvoiceUpdatePayload = {};
    if (meter_id) payload.meter_id = meter_id;
    if (period_start_date !== undefined) payload.period_start_date = period_start_date;
    if (period_end_date !== undefined) payload.period_end_date = period_end_date;

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
    const supabase = createSupabaseServerClient();
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