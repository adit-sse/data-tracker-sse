import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import type { IdentifierType } from '@/types';
import { getCurrentFiscalYearMonthsThroughNow } from '@/lib/non-metered-pending-seed';
import { meterMonthBlocksNewPending, resolveMeterForIngestion } from '@/lib/ingestion-metered';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const IDENTIFIER_TYPES: readonly IdentifierType[] = [
  'NMI',
  'MIRN',
  'ACCOUNT_NUMBER',
  'METER_NUMBER',
  'REGISTRATION_PLATE',
  'CARD_NUMBER',
  'FACILITY_LEVEL',
  'DESCRIPTION',
] as const;

function checkApiKey(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === process.env.INGESTION_API_KEY;
}

// POST /api/ingestion/metered/pending
// Seeds actual_invoices with status PENDING (full calendar month) for FY Jul → current month.
// Body: client_name, supplier_name, utility_name, facility_name, identifier_type, lookup1 [, lookup2]
export async function POST(request: Request) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const pendingReceivedAt = new Date().toISOString();
    const supabase = createSupabaseServiceRoleClient();
    const body = await request.json();
    const { client_name, supplier_name, utility_name, facility_name, identifier_type, lookup1, lookup2 } =
      body;

    if (!client_name || !supplier_name || !utility_name) {
      return NextResponse.json(
        { error: 'client_name, supplier_name and utility_name are required' },
        { status: 400 }
      );
    }
    if (!identifier_type || !lookup1) {
      return NextResponse.json({ error: 'identifier_type and lookup1 are required' }, { status: 400 });
    }
    if (!IDENTIFIER_TYPES.includes(identifier_type as IdentifierType)) {
      return NextResponse.json({ error: `Invalid identifier_type: ${identifier_type}` }, { status: 400 });
    }

    const facilityNameStr = typeof facility_name === 'string' ? facility_name : '';
    const resolved = await resolveMeterForIngestion(supabase, {
      clientName: client_name,
      facilityName: facilityNameStr.trim(),
      supplierName: supplier_name,
      utilityName: utility_name,
      identifierType: identifier_type as IdentifierType,
      lookup1: String(lookup1),
      lookup2: lookup2 ?? null,
    });

    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const months = getCurrentFiscalYearMonthsThroughNow();
    const toInsert: Array<{
      meter_id: string;
      period_start_date: string;
      period_end_date: string;
      status: string;
      created_at: string;
    }> = [];

    for (const month of months) {
      if (await meterMonthBlocksNewPending(supabase, resolved.meterId, month.start, month.end)) {
        continue;
      }
      toInsert.push({
        meter_id: resolved.meterId,
        period_start_date: month.start,
        period_end_date: month.end,
        status: 'PENDING',
        created_at: pendingReceivedAt,
      });
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await supabase.from('actual_invoices').insert(toInsert);
      if (insertError) throw insertError;
    }

    return NextResponse.json({
      created: toInsert.length,
      skipped: months.length - toInsert.length,
      meter_id: resolved.meterId,
    });
  } catch (error) {
    console.error('Error in ingestion/metered/pending:', error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Internal server error', detail }, { status: 500 });
  }
}
