import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { logIngestionFromResponse } from '@/lib/ingestion-events';
import { checkApiKey } from '@/lib/ingestion-auth';
import { type NgersMeterRow } from '@/lib/ingestion-metered';
import { processMeteredRows } from '@/lib/ingestion-confirm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// POST /api/ingestion/metered/confirm
// Body: { "rows": [ NGERS-style rows ... ], "prune_orphan_pending"?: boolean }
// Updates PENDING rows overlapping the confirmed period to CONFIRMED with exact dates;
// reconciles gap PENDING for partial months; optional prune_orphan_pending restores legacy
// FY-wide deletion of PENDING rows for months not present in this request.
//
// All lookup failures (client, facility, supplier, input type, meter, date range) return
// a hard 4xx — nothing is silently skipped.
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
      endpoint: 'metered/confirm',
      scopeKind: 'metered',
      request: null,
      response: res,
      startedAt,
    });
    return res;
  }

  try {
    if (!body || typeof body !== 'object' || !Array.isArray((body as { rows?: unknown }).rows)) {
      const res = NextResponse.json({ error: 'Body must be { "rows": [ ... NGERS rows ] }' }, { status: 400 });
      await logIngestionFromResponse(supabase, {
        endpoint: 'metered/confirm',
        scopeKind: 'metered',
        request: body,
        response: res,
        startedAt,
      });
      return res;
    }

    const rows = (body as { rows: NgersMeterRow[] }).rows;
    if (rows.length === 0) {
      const res = NextResponse.json({ error: 'rows must be non-empty' }, { status: 400 });
      await logIngestionFromResponse(supabase, {
        endpoint: 'metered/confirm',
        scopeKind: 'metered',
        request: body,
        response: res,
        startedAt,
      });
      return res;
    }

    const confirmedAt = new Date().toISOString();

    const result = await processMeteredRows(supabase, rows, confirmedAt);

    const res = result.ok
      ? NextResponse.json({
          mode: 'metered',
          confirmed: result.confirmed,
          deleted_pending: result.deleted_pending,
          skipped_duplicates: result.skipped_duplicates,
          gap_pending_inserted: result.gap_pending_inserted,
        })
      : NextResponse.json({ error: result.error }, { status: result.status });

    await logIngestionFromResponse(supabase, {
      endpoint: 'metered/confirm',
      scopeKind: 'metered',
      request: body,
      response: res,
      startedAt,
    });
    return res;
  } catch (error) {
    console.error('Error in ingestion/metered/confirm:', error);
    const detail = error instanceof Error ? error.message : String(error);
    const res = NextResponse.json({ error: 'Internal server error', detail }, { status: 500 });
    await logIngestionFromResponse(supabase, {
      endpoint: 'metered/confirm',
      scopeKind: 'metered',
      request: body,
      response: res,
      startedAt,
    });
    return res;
  }
}
