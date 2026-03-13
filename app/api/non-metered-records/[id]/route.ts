export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// PATCH /api/non-metered-records/[id] - Update a non-metered record (e.g. mark as received)
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const allowed = ['status', 'consumption', 'unit', 'amount', 'invoice_number', 'invoice_date', 'sub_category', 'input_type', 'framework', 'version', 'customer'];

    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('non_metered_records')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating non-metered record:', error);
    return NextResponse.json({ error: 'Failed to update record' }, { status: 500 });
  }
}
