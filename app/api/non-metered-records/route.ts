export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { upsertNonMeteredLine } from '@/lib/non-metered-lines';

// POST /api/non-metered-records - Create a new manual non-metered record
export async function POST(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();
    const {
      facility_id,
      supplier_id,
      input_type_id,
      period_start_date,
      period_end_date,
      status = 'MANUAL',
      consumption,
      unit,
      amount,
      invoice_number,
      invoice_date,
    } = body;

    if (!facility_id || !input_type_id || !period_start_date || !period_end_date) {
      return NextResponse.json(
        { error: 'facility_id, input_type_id, period_start_date and period_end_date are required' },
        { status: 400 }
      );
    }

    if (!supplier_id) {
      return NextResponse.json(
        { error: 'supplier_id is required' },
        { status: 400 }
      );
    }

    const { id: lineId } = await upsertNonMeteredLine(supabase, {
      facilityId: String(facility_id),
      supplierId: String(supplier_id),
      inputTypeId: String(input_type_id),
    });

    const { data, error } = await supabase
      .from('non_metered_records')
      .insert({
        non_metered_line_id: lineId,
        facility_id,
        supplier_id,
        input_type_id,
        period_start_date,
        period_end_date,
        status,
        consumption: consumption ?? null,
        unit: unit || null,
        amount: amount ?? null,
        invoice_number: invoice_number || null,
        invoice_date: invoice_date || null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Error creating non-metered record:', error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Failed to create record', detail }, { status: 500 });
  }
}
