export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  attachTriageToEvents,
  isTriageStatus,
  resolveActivityEventIdFilter,
} from '@/lib/ingestion-event-triage';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// GET /api/activity
//   ?outcome=FAILURE|SUCCESS         (omit for all)
//   &clientId=<id>                   (filter to one client)
//   &limit=<n>                       (default 100, max 500)
//   &before=<ISO timestamp>          (cursor: only events created before this, for "load more")
//   &from=<ISO timestamp>            (inclusive lower bound on created_at)
//   &to=<ISO timestamp>              (inclusive upper bound on created_at)
//   &triageStatus=unreviewed|in_progress|addressed
//   &hideAddressed=true              (exclude addressed events)
//   &tag=<text>                      (partial match on custom tag labels)
//
// Returns recent ingestion_events (confirm/error attempts) across all clients the caller
// can access, newest first. Each event includes embedded triage (status, note, custom tags).
function parseIsoTimestamp(value: string | null): string | null {
  if (!value?.trim()) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

export async function GET(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const { searchParams } = new URL(request.url);

    const outcome = searchParams.get('outcome');
    const clientIdParam = searchParams.get('clientId');
    const before = searchParams.get('before');
    const from = parseIsoTimestamp(searchParams.get('from'));
    const to = parseIsoTimestamp(searchParams.get('to'));
    const triageStatusParam = searchParams.get('triageStatus');
    const hideAddressed = searchParams.get('hideAddressed') === 'true';
    const tag = searchParams.get('tag')?.trim() ?? '';

    if (searchParams.get('from') && !from) {
      return NextResponse.json({ error: 'Invalid from timestamp' }, { status: 400 });
    }
    if (searchParams.get('to') && !to) {
      return NextResponse.json({ error: 'Invalid to timestamp' }, { status: 400 });
    }
    if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
      return NextResponse.json({ error: 'from must be before to' }, { status: 400 });
    }
    if (triageStatusParam && !isTriageStatus(triageStatusParam)) {
      return NextResponse.json(
        { error: 'triageStatus must be unreviewed, in_progress, or addressed' },
        { status: 400 }
      );
    }

    const limitParam = Number(searchParams.get('limit'));
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(Math.floor(limitParam), MAX_LIMIT)
        : DEFAULT_LIMIT;

    const idFilter = await resolveActivityEventIdFilter(supabase, {
      triageStatus: triageStatusParam && isTriageStatus(triageStatusParam) ? triageStatusParam : null,
      hideAddressed,
      tag: tag || null,
    });

    if (idFilter === 'empty') {
      return NextResponse.json(
        { data: [], nextCursor: null },
        {
          headers: {
            'Cache-Control': 'private, max-age=15, stale-while-revalidate=30',
          },
        }
      );
    }

    let query = supabase
      .from('ingestion_events')
      .select(
        'id, created_at, endpoint, outcome, scope_kind, group_id, client_id, client_name, supplier_name, facility_name, utility_name, period_start, reason, http_status, affected_count, duration_ms, client:clients(id, name)'
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

    if (from) {
      query = query.gte('created_at', from);
    }

    if (to) {
      query = query.lte('created_at', to);
    }

    if (before) {
      query = query.lt('created_at', before);
    }

    if (idFilter.includeIds) {
      query = query.in('id', idFilter.includeIds);
    }

    if (idFilter.excludeIds.length > 0) {
      query = query.not('id', 'in', `(${idFilter.excludeIds.join(',')})`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const events = data ?? [];
    const dataWithTriage = await attachTriageToEvents(supabase, events);
    const nextCursor = events.length === limit ? events[events.length - 1]?.created_at ?? null : null;

    return NextResponse.json(
      { data: dataWithTriage, nextCursor },
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
