import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { parseMeterIdentifierFromNgersRow, type NgersMeterRow } from '@/lib/ingestion-metered';
import { logIngestionFromResponse } from '@/lib/ingestion-events';
import { checkApiKey } from '@/lib/ingestion-auth';
import {
  processNonMeteredGroupRows,
  processNonMeteredLineRows,
  processMeteredRows,
  type UnifiedRow,
} from '@/lib/ingestion-confirm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ── Row classification ────────────────────────────────────────────────────────

type RowType = 'metered' | 'nm_group' | 'nm_line';

function classifyRow(row: UnifiedRow): RowType {
  const iden = parseMeterIdentifierFromNgersRow(row as NgersMeterRow);
  if (iden.ok) return 'metered';
  const category = typeof row.Category === 'string' ? row.Category.trim() : '';
  return category ? 'nm_group' : 'nm_line';
}

// ── Route handler ─────────────────────────────────────────────────────────────

// POST /api/ingestion/unified-confirm
//
// Unified endpoint — handles non-metered group, non-metered line, and metered
// (Scope 2) rows in a single call. Row type is auto-detected per row:
//
//   Has NMI / MIRN / Account Number / Meter Number  → metered path (actual_invoices)
//   No meter identifier + non-empty Category        → non-metered group path (facility_groups)
//   No meter identifier + no Category               → non-metered line path (non_metered_lines)
//
// Body: non-empty JSON array of NGERS rows (types can be mixed), or
//       { "rows": [ ... ], "prune_orphan_pending"?: boolean } for optional legacy FY-wide pending prune.
//
// All lookup failures (client, supplier, category, input type, facility, date range) return
// a hard 4xx — nothing is silently skipped.
//
// Response on success:
//   {
//     "non_metered": { "confirmed": n },
//     "metered":     { "confirmed": n, "deleted_pending": n, "skipped_duplicates": n, "gap_pending_inserted": n }
//   }
async function handleUnifiedConfirm(supabase: SupabaseClient, raw: unknown): Promise<NextResponse> {
  try {
    let rows: UnifiedRow[];
    let pruneOrphanPending = false;

    if (Array.isArray(raw)) {
      if (raw.length === 0) {
        return NextResponse.json(
          { error: 'Request body must be a non-empty JSON array of NGERS rows' },
          { status: 400 }
        );
      }
      rows = raw as UnifiedRow[];
    } else if (
      raw &&
      typeof raw === 'object' &&
      Array.isArray((raw as { rows?: unknown }).rows) &&
      ((raw as { rows: unknown[] }).rows as unknown[]).length > 0
    ) {
      rows = (raw as { rows: UnifiedRow[] }).rows;
      pruneOrphanPending = Boolean((raw as { prune_orphan_pending?: unknown }).prune_orphan_pending);
    } else {
      return NextResponse.json(
        {
          error:
            'Request body must be a non-empty JSON array of NGERS rows, or an object { "rows": [ ... ] }',
        },
        { status: 400 }
      );
    }

    const confirmedAt = new Date().toISOString();

    const meteredRows: NgersMeterRow[] = [];
    const nmGroupRows: UnifiedRow[] = [];
    const nmLineRows: UnifiedRow[] = [];

    for (const row of rows) {
      const type = classifyRow(row);
      if (type === 'metered') meteredRows.push(row as NgersMeterRow);
      else if (type === 'nm_group') nmGroupRows.push(row);
      else nmLineRows.push(row);
    }

    const [nonMeteredGroupResult, nonMeteredLineResult, meteredResult] = await Promise.all([
      nmGroupRows.length > 0
        ? processNonMeteredGroupRows(supabase, nmGroupRows, confirmedAt)
        : Promise.resolve({ ok: true as const, confirmed: 0 }),
      nmLineRows.length > 0
        ? processNonMeteredLineRows(supabase, nmLineRows, confirmedAt)
        : Promise.resolve({ ok: true as const, confirmed: 0 }),
      meteredRows.length > 0
        ? processMeteredRows(supabase, meteredRows, confirmedAt, pruneOrphanPending)
        : Promise.resolve({
            ok: true as const,
            confirmed: 0,
            deleted_pending: 0,
            skipped_duplicates: 0,
            gap_pending_inserted: 0,
          }),
    ]);

    if (!nonMeteredGroupResult.ok) {
      return NextResponse.json({ error: nonMeteredGroupResult.error }, { status: nonMeteredGroupResult.status });
    }
    if (!nonMeteredLineResult.ok) {
      return NextResponse.json({ error: nonMeteredLineResult.error }, { status: nonMeteredLineResult.status });
    }
    if (!meteredResult.ok) {
      return NextResponse.json({ error: meteredResult.error }, { status: meteredResult.status });
    }

    return NextResponse.json({
      non_metered: {
        confirmed: nonMeteredGroupResult.confirmed + nonMeteredLineResult.confirmed,
      },
      metered: {
        confirmed: meteredResult.confirmed,
        deleted_pending: meteredResult.deleted_pending,
        skipped_duplicates: meteredResult.skipped_duplicates,
        gap_pending_inserted: meteredResult.gap_pending_inserted,
      },
    });
  } catch (error) {
    console.error('Error in ingestion/unified-confirm:', error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Internal server error', detail }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createSupabaseServiceRoleClient();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    const res = NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    await logIngestionFromResponse(supabase, {
      endpoint: 'unified-confirm',
      scopeKind: 'mixed',
      request: null,
      response: res,
      startedAt,
    });
    return res;
  }

  const res = await handleUnifiedConfirm(supabase, raw);
  await logIngestionFromResponse(supabase, {
    endpoint: 'unified-confirm',
    scopeKind: 'mixed',
    request: raw,
    response: res,
    startedAt,
  });
  return res;
}
