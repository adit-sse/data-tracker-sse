import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { checkApiKey } from '@/lib/ingestion-auth';
import { logIngestionErrorReport } from '@/lib/ingestion-events';
import { parseMeterIdentifierFromNgersRow, type NgersMeterRow } from '@/lib/ingestion-metered';
import { markMeteredError, markNonMeteredError, type ErrorScope } from '@/lib/ingestion-error';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type UnifiedRow = Record<string, unknown>;

// POST /api/ingestion/unified-error
//
// When an upstream ingestion step (confirm / inferred-empty / revert-pending) fails,
// flip the PENDING row for that month → ERROR. Auto-detects scope the same way
// /unified-confirm does, so a single n8n error node fed by every error output can
// handle all cases — including errors that happen before the workflow's group/line
// branch (where the workflow itself doesn't yet know which scope it is).
//
// Body: the original NGERS row context + optional reason:
//   {
//     "Company": "...", "Provider": "...", "Facility": "...",
//     "Category": "...",          // empty for standalone lines
//     "Input Type": "...",
//     "Date Range": "DD/MM/YYYY - DD/MM/YYYY",
//     "NMI" | "MIRN" | "Account Number" | "Meter Number": "...",  // metered only
//     "reason": "..."             // optional — recorded on the ingestion_events log
//   }
//
// Detection:
//   Has NMI / MIRN / Account Number / Meter Number → metered (actual_invoices)
//   No meter identifier + non-empty Category        → non-metered group (facility_groups)
//   No meter identifier + no Category               → non-metered line (non_metered_lines)
//
// Only PENDING rows are flipped to ERROR. CONFIRMED / INFERRED_EMPTY / etc. are untouched.
async function handleUnifiedError(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  raw: unknown
): Promise<{ response: NextResponse; scope: ErrorScope | null; groupId: number | null }> {
  const row =
    raw && typeof raw === 'object' ? (raw as UnifiedRow) : {};

  const Company = typeof row.Company === 'string' ? row.Company.trim() : '';
  const Provider = typeof row.Provider === 'string' ? row.Provider.trim() : '';
  const Facility = typeof row.Facility === 'string' ? row.Facility.trim() : '';
  const Category = typeof row.Category === 'string' ? row.Category.trim() : '';
  const InputType = typeof row['Input Type'] === 'string' ? (row['Input Type'] as string).trim() : '';
  const DateRange = typeof row['Date Range'] === 'string' ? row['Date Range'] : '';

  if (!Company || !Provider || !DateRange) {
    return {
      response: NextResponse.json(
        { error: 'Company, Provider, and Date Range are required' },
        { status: 400 }
      ),
      scope: null,
      groupId: null,
    };
  }

  const iden = parseMeterIdentifierFromNgersRow(row as NgersMeterRow);
  const scope: ErrorScope = iden.ok ? 'metered' : Category ? 'group' : 'line';

  // Standalone line needs an Input Type to resolve on.
  if (scope === 'line' && !InputType) {
    return {
      response: NextResponse.json(
        { error: 'Input Type is required when the row has no NMI/MIRN/Account/Meter Number and no Category (line scope)' },
        { status: 400 }
      ),
      scope,
      groupId: null,
    };
  }

  if (scope === 'metered') {
    // iden is ok here, but narrow for TS.
    if (!iden.ok) {
      return {
        response: NextResponse.json({ error: iden.error }, { status: 400 }),
        scope,
        groupId: null,
      };
    }
    const result = await markMeteredError(supabase, {
      client_name: Company,
      supplier_name: Provider,
      utility_name: Category,
      facility_name: Facility,
      identifier_type: iden.identifier_type,
      lookup1: iden.lookup1,
      lookup2: iden.lookup2,
      date_range: DateRange,
    });

    if (!result.ok) {
      return {
        response: NextResponse.json({ error: result.error }, { status: result.status }),
        scope,
        groupId: null,
      };
    }
    return {
      response: NextResponse.json({
        scope: result.scope,
        updated: result.updated,
        period_start_date: result.periodStart,
        meter_id: result.meterId,
      }),
      scope: result.scope,
      groupId: null,
    };
  }

  // Non-metered (group or line).
  const result = await markNonMeteredError(supabase, {
    client_name: Company,
    supplier_name: Provider,
    utility_name: scope === 'line' ? InputType : Category,
    date_range: DateRange,
    mode: scope === 'line' ? 'line' : undefined,
    facility_name: Facility || undefined,
  });

  if (!result.ok) {
    return {
      response: NextResponse.json({ error: result.error }, { status: result.status }),
      scope,
      groupId: null,
    };
  }
  return {
    response: NextResponse.json({
      scope: result.scope,
      updated: result.updated,
      period_start_date: result.periodStart,
      group_id: result.groupId ?? null,
    }),
    scope: result.scope,
    groupId: result.groupId ?? null,
  };
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
    await logIngestionErrorReport(supabase, {
      endpoint: 'unified-error',
      scopeKind: null,
      groupId: null,
      request: null,
      response: res,
      startedAt,
    });
    return res;
  }

  const { response, scope, groupId } = await handleUnifiedError(supabase, body);

  await logIngestionErrorReport(supabase, {
    endpoint: 'unified-error',
    scopeKind: scope,
    groupId,
    request: body,
    response,
    startedAt,
  });
  return response;
}
