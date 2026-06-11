import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { logIngestionErrorReport } from '@/lib/ingestion-events';
import { parseNgersDateRange, monthStartIso } from '@/lib/ingestion-dates';
import type { IdentifierType } from '@/types';
import { resolveMeterForIngestion } from '@/lib/ingestion-metered';

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

// POST /api/ingestion/metered/error
// Marks PENDING actual_invoices as ERROR for the calendar month of date_range start.
// Body: client_name, supplier_name, utility_name, facility_name, identifier_type, lookup1 [, lookup2], date_range
async function handleMeteredError(
  supabase: SupabaseClient,
  body: Record<string, unknown>
): Promise<NextResponse> {
  try {
    const {
      client_name,
      supplier_name,
      utility_name,
      facility_name,
      identifier_type,
      lookup1,
      lookup2,
      date_range,
    } = body as {
      client_name?: string;
      supplier_name?: string;
      utility_name?: string;
      facility_name?: string;
      identifier_type?: string;
      lookup1?: string;
      lookup2?: string | null;
      date_range?: string;
    };

    if (!client_name || !supplier_name || !utility_name || !date_range) {
      return NextResponse.json(
        { error: 'client_name, supplier_name, utility_name, and date_range are required' },
        { status: 400 }
      );
    }
    if (!identifier_type || !lookup1) {
      return NextResponse.json({ error: 'identifier_type and lookup1 are required' }, { status: 400 });
    }
    if (!IDENTIFIER_TYPES.includes(identifier_type as IdentifierType)) {
      return NextResponse.json({ error: `Invalid identifier_type: ${identifier_type}` }, { status: 400 });
    }

    const parsed = parseNgersDateRange(String(date_range));
    if (!parsed) {
      return NextResponse.json({ error: 'date_range must be "DD/MM/YYYY - DD/MM/YYYY"' }, { status: 400 });
    }

    const periodStart = monthStartIso(parsed.start);

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

    const { data: pendingRows, error: fetchError } = await supabase
      .from('actual_invoices')
      .select('id')
      .eq('meter_id', resolved.meterId)
      .eq('period_start_date', periodStart)
      .eq('status', 'PENDING');

    if (fetchError) throw fetchError;

    const ids = (pendingRows ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) {
      return NextResponse.json({
        mode: 'metered',
        updated: 0,
        message: `No PENDING invoices for ${periodStart}. Run /api/ingestion/metered/pending first, or this month was already resolved.`,
      });
    }

    const { error: updateError } = await supabase
      .from('actual_invoices')
      .update({ status: 'ERROR' })
      .in('id', ids);

    if (updateError) throw updateError;

    return NextResponse.json({
      mode: 'metered',
      updated: ids.length,
      period_start_date: periodStart,
      meter_id: resolved.meterId,
    });
  } catch (error) {
    console.error('Error in ingestion/metered/error:', error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Internal server error', detail }, { status: 500 });
  }
}

// POST body may include an optional `reason` describing why the upstream ingestion failed;
// it is recorded on the ingestion_events log (the invoice itself is only flipped to ERROR).
export async function POST(request: Request) {
  const startedAt = Date.now();
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createSupabaseServiceRoleClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    const res = NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    await logIngestionErrorReport(supabase, {
      endpoint: 'metered/error',
      scopeKind: 'metered',
      request: null,
      response: res,
      startedAt,
    });
    return res;
  }

  const res = await handleMeteredError(supabase, body);
  await logIngestionErrorReport(supabase, {
    endpoint: 'metered/error',
    scopeKind: 'metered',
    request: body,
    response: res,
    startedAt,
  });
  return res;
}
