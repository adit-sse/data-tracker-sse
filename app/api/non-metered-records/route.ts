export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST /api/non-metered-records - Create a new manual non-metered record
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      facility_id,
      supplier_id,
      utility_category_id,
      period_start_date,
      period_end_date,
      status = 'MANUAL',
      consumption,
      unit,
      amount,
      invoice_number,
      invoice_date,
      sub_category,
    } = body;

    if (!facility_id || !utility_category_id || !period_start_date || !period_end_date) {
      return NextResponse.json(
        { error: 'facility_id, utility_category_id, period_start_date and period_end_date are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('non_metered_records')
      .insert({
        facility_id,
        supplier_id: supplier_id || null,
        utility_category_id,
        period_start_date,
        period_end_date,
        status,
        consumption: consumption ?? null,
        unit: unit || null,
        amount: amount ?? null,
        invoice_number: invoice_number || null,
        invoice_date: invoice_date || null,
        sub_category: sub_category || null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Error creating non-metered record:', error);
    return NextResponse.json({ error: 'Failed to create record' }, { status: 500 });
  }
}
