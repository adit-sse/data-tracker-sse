export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { fetchSheetRowsCached, isSheetsConfigured } from '@/lib/google-sheets';
import { STAGING_SHEET_ID, STAGING_TAB } from '@/lib/intake-report/config';
import { isUnprocessedRow, toIntakeFileRow, type StagingRow } from '@/lib/intake-report/classify';
import { currentWeekKey, isInWeek, isWeekKey, parseSheetTime } from '@/lib/intake-report/dates';
import { buildIntakeReport } from '@/lib/intake-report/summarise';
import type { IntakeReportPayload } from '@/types';

// GET /api/intake-report
//   ?week=YYYY-MM-DD   Monday of the week to report on (default: current week)
//   &refresh=true      bypass the 5-minute sheet cache
//
// Reads p1EmailStaging, filters to the requested Perth week, and classifies each
// file into done / action needed / ignored.
//
// Auth is handled by middleware.ts, which requires a Supabase session on every
// /api/* path except /api/ingestion/*.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const weekParam = searchParams.get('week');
  if (weekParam && !isWeekKey(weekParam)) {
    return NextResponse.json(
      { error: 'week must be a valid YYYY-MM-DD date' },
      { status: 400 },
    );
  }
  const weekKey = weekParam ?? currentWeekKey();

  // Credentials may land after this code does. An unconfigured install should
  // render setup copy, not an error.
  if (!isSheetsConfigured()) {
    const empty: IntakeReportPayload = {
      configured: false,
      ...buildIntakeReport(weekKey, []),
    };
    return NextResponse.json(empty);
  }

  try {
    const rows = await fetchSheetRowsCached(STAGING_SHEET_ID, STAGING_TAB, {
      refresh: searchParams.get('refresh') === 'true',
    });

    // A row whose Time won't parse can't be placed in any week, so it drops out
    // of every report — same as the n8n job. Counting them makes that visible
    // instead of silent: a rising number here means files are going unreported.
    let unparseableTimes = 0;

    // Files the pipeline hasn't attempted yet have no outcome to report, so they
    // are left out rather than bucketed. Counted for the same reason as above —
    // a growing number means the pipeline has stalled, which is worth noticing.
    let notYetProcessed = 0;

    const inWeek = (rows as StagingRow[]).filter((row) => {
      if (isUnprocessedRow(row)) {
        notYetProcessed += 1;
        return false;
      }

      const time = parseSheetTime(row.Time);
      if (time === null) {
        unparseableTimes += 1;
        return false;
      }
      return isInWeek(time, weekKey);
    });

    if (unparseableTimes > 0) {
      console.warn(
        `[intake-report] ${unparseableTimes} staging row(s) have an unreadable Time and are absent from every week.`,
      );
    }

    if (notYetProcessed > 0) {
      console.info(
        `[intake-report] ${notYetProcessed} staging row(s) are not yet processed and are excluded from the report.`,
      );
    }

    const payload: IntakeReportPayload = {
      configured: true,
      ...buildIntakeReport(weekKey, inWeek.map(toIntakeFileRow)),
    };

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Error building intake report:', error);
    return NextResponse.json(
      { error: 'Failed to read the intake log' },
      { status: 500 },
    );
  }
}
