export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// GET /api/activity
//   ?outcome=FAILURE|SUCCESS         (omit for all)
//   &clientId=<id>                   (filter to one client)
//   &limit=<n>                       (default 100, max 500)
//   &before=<ISO timestamp>          (cursor: only events created before this, for "load more")
//
// Returns recent ingestion_events (confirm/error attempts) across all clients the caller
// can access, newest first. RLS on ingestion_events scopes rows to the user's clients.
export async function GET(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const { searchParams } = new URL(request.url);

    const outcome = searchParams.get('outcome');
    const clientIdParam = searchParams.get('clientId');
    const before = searchParams.get('before');

    const limitParam = Number(searchParams.get('limit'));
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(Math.floor(limitParam), MAX_LIMIT)
        : DEFAULT_LIMIT;

    let query = supabase
      .from('ingestion_events')
      .select(
        'id, created_at, endpoint, outcome, scope_kind, client_id, client_name, supplier_name, facility_name, utility_name, period_start, reason, http_status, affected_count, duration_ms, client:clients(id, name)'
      )
      .order('created_at', { ascending: false })
      .limit(limit);

    if (outcome === 'FAILURE' || outcome === 'SUCCESS') {
      query = query.eq('outcome', outcome);
    }

    if (clientIdParam) {
      const cid = Number(clientIdParam);
      if (Number.isFinite(cid)) {
        query = query.eq('client_id', cid);
      }
    }

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data, error } = await query;
    if (error) throw error;

    const events = data ?? [];
    const nextCursor = events.length === limit ? events[events.length - 1]?.created_at ?? null : null;

    return NextResponse.json(
      { data: events, nextCursor },
      {
        headers: {
          'Cache-Control': 'private, max-age=15, stale-while-revalidate=30',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching activity:', error);
    return NextResponse.json({ data: [], error: 'Failed to fetch activity' }, { status: 500 });
  }
}
