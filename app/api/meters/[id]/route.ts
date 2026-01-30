export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// DELETE /api/meters/[id] - Delete a meter and its invoices
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    // Delete invoices for this meter
    const { error: invoicesError } = await supabase
      .from('actual_invoices')
      .delete()
      .eq('meter_id', params.id);

    if (invoicesError) throw invoicesError;

    // Delete the meter
    const { error: meterError } = await supabase
      .from('meters')
      .delete()
      .eq('id', params.id);

    if (meterError) throw meterError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting meter:', error);
    return NextResponse.json(
      { error: 'Failed to delete meter' },
      { status: 500 }
    );
  }
}
