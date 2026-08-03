export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { fetchSheetRowsCached, isSheetsConfigured } from '@/lib/google-sheets';
import { TICKETS_SHEET_ID, TICKETS_TAB } from '@/lib/intake-report/config';
import { toOpenIssue, type TicketRow } from '@/lib/intake-report/tickets';
import { buildOpenIssues } from '@/lib/intake-report/summarise';
import type { OpenIssuesPayload } from '@/types';

// GET /api/open-issues
//   ?refresh=true   bypass the 5-minute sheet cache
//
// Reads ticket_tracker_template / Tickets_Current — the rolling backlog of
// errors the team is working through. Unlike the weekly report this has no date
// window: an issue is relevant until someone closes it.
//
// Auth is handled by middleware.ts.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  if (!isSheetsConfigured()) {
    const empty: OpenIssuesPayload = {
      configured: false,
      ...buildOpenIssues([]),
    };
    return NextResponse.json(empty);
  }

  try {
    const rows = await fetchSheetRowsCached(TICKETS_SHEET_ID, TICKETS_TAB, {
      refresh: searchParams.get('refresh') === 'true',
    });

    const now = new Date();
    const payload: OpenIssuesPayload = {
      configured: true,
      ...buildOpenIssues((rows as TicketRow[]).map((row) => toOpenIssue(row, now))),
    };

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Error reading open issues:', error);
    return NextResponse.json(
      { error: 'Failed to read the ticket tracker' },
      { status: 500 },
    );
  }
}
