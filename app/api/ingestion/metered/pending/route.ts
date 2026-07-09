import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import type { IdentifierType } from '@/types';
import { getCurrentFiscalYearMonthsThroughNow } from '@/lib/non-metered-pending-seed';
import { resolveMeterForIngestion } from '@/lib/ingestion-metered';
import { checkApiKey } from '@/lib/ingestion-auth';
import { logIngestionFromResponse } from '@/lib/ingestion-events';
import { upsertPendingMonthSlots } from '@/lib/meter-month-slots';
import type { SupabaseClient } from '@supabase/supabase-js';

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

// POST /api/ingestion/metered/pending
// Seeds actual_invoices with status PENDING (full calendar month) for FY Jul → current month.
// Body: client_name, supplier_name, utility_name, facility_name, identifier_type, lookup1 [, lookup2]
async function handleMeteredPending(
  supabase: SupabaseClient,
  body: Record<string, unknown>
): Promise<NextResponse> {
  const pendingReceivedAt = new Date().toISOString();
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
    clientName: String(client_name),
    facilityName: facilityNameStr.trim(),
    supplierName: String(supplier_name),
    utilityName: String(utility_name),
    identifierType: identifier_type as IdentifierType,
    lookup1: String(lookup1),
    lookup2: lookup2 != null ? String(lookup2) : null,
  });

  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  const months = getCurrentFiscalYearMonthsThroughNow();
  if (months.length === 0) {
    return NextResponse.json({ created: 0, skipped: 0, meter_id: resolved.meterId });
  }

  // Upsert a PENDING slot for every FY month. ignoreDuplicates means existing
  // ERROR/DEACTIVATED slots are left untouched; only missing slots get created.
  await upsertPendingMonthSlots(
    supabase,
    resolved.meterId,
    months[0].start,
    months[months.length - 1].end
  );

  return NextResponse.json({
    created: months.length,
    skipped: 0,
    meter_id: resolved.meterId,
  });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createSupabaseServiceRoleClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const res = NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    await logIngestionFromResponse(supabase, {
      endpoint: 'metered/pending',
      scopeKind: 'metered',
      request: null,
      response: res,
      startedAt,
    });
    return res;
  }

  try {
    const reqBody =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const res = await handleMeteredPending(supabase, reqBody);
    await logIngestionFromResponse(supabase, {
      endpoint: 'metered/pending',
      scopeKind: 'metered',
      request: body,
      response: res,
      startedAt,
    });
    return res;
  } catch (error) {
    console.error('Error in ingestion/metered/pending:', error);
    const detail = error instanceof Error ? error.message : String(error);
    const res = NextResponse.json({ error: 'Internal server error', detail }, { status: 500 });
    await logIngestionFromResponse(supabase, {
      endpoint: 'metered/pending',
      scopeKind: 'metered',
      request: body,
      response: res,
      startedAt,
    });
    return res;
  }
}
