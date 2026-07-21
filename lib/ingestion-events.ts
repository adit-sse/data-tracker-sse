import type { SupabaseClient } from '@supabase/supabase-js';
import { lookupClientByName } from '@/lib/name-lookup';
import type { NextResponse } from 'next/server';

/**
 * Ingestion event logging.
 *
 * Confirm/error ingestion calls historically left no trace of *why* they failed —
 * the reason only existed in the HTTP response returned to the automation (n8n) and
 * in server console logs. This module persists each attempt to `public.ingestion_events`
 * (see migration 013) so a cross-client /activity page can surface failed/attempted
 * confirms with their reason.
 *
 * Logging is strictly best-effort: a failure to write the log must never break ingestion.
 */

export type IngestionOutcome = 'SUCCESS' | 'FAILURE';

export interface IngestionEventInput {
  endpoint: string;
  outcome: IngestionOutcome;
  scope_kind?: string | null;
  group_id?: number | null;
  client_id?: number | null;
  client_name?: string | null;
  supplier_name?: string | null;
  facility_name?: string | null;
  utility_name?: string | null;
  period_start?: string | null;
  reason?: string | null;
  http_status?: number | null;
  affected_count?: number | null;
  payload_excerpt?: unknown;
  duration_ms?: number | null;
}

interface Identity {
  client_name: string | null;
  supplier_name: string | null;
  facility_name: string | null;
  utility_name: string | null;
  period_start: string | null;
}

const MAX_PAYLOAD_ROWS = 5;

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** First day of the calendar month for a "DD/MM/YYYY - ..." or "YYYY-MM-DD" date string. */
function periodStartFromDateString(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  // "DD/MM/YYYY - DD/MM/YYYY" or "DD/MM/YYYY"
  const ddmmyyyy = s.split(' - ')[0].trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyy) {
    return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-01`;
  }
  // ISO "YYYY-MM-DD..."
  const iso = s.match(/^(\d{4})-(\d{2})-\d{2}/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-01`;
  }
  return null;
}

/**
 * Pull identifying fields from a request body. Handles three shapes:
 *   - an array of NGERS rows                → first row
 *   - { rows: [ ...NGERS rows ] }           → first row
 *   - a flat object (the /error route body) → the object itself
 *
 * Reads both NGERS column names (Company/Provider/Facility/Category/Input Type/Date Range)
 * and the /error route field names (client_name/supplier_name/facility_name/utility_name/date_range).
 */
function extractIdentity(raw: unknown): Identity {
  let row: Record<string, unknown> | null = null;

  if (Array.isArray(raw)) {
    row = (raw[0] as Record<string, unknown>) ?? null;
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.rows)) {
      row = (obj.rows[0] as Record<string, unknown>) ?? null;
    } else {
      row = obj;
    }
  }

  if (!row) {
    return {
      client_name: null,
      supplier_name: null,
      facility_name: null,
      utility_name: null,
      period_start: null,
    };
  }

  return {
    client_name: str(row.Company) ?? str(row.client_name),
    supplier_name: str(row.Provider) ?? str(row.supplier_name),
    facility_name: str(row.Facility) ?? str(row.facility_name),
    utility_name: str(row.Category) ?? str(row['Input Type']) ?? str(row.utility_name),
    period_start: periodStartFromDateString(row['Date Range'] ?? row.date_range),
  };
}

/** A trimmed copy of the request body, capped in size, safe to store as JSONB. */
function trimPayload(raw: unknown): unknown {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    return { rows: raw.slice(0, MAX_PAYLOAD_ROWS), total_rows: raw.length };
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.rows)) {
      return { ...obj, rows: obj.rows.slice(0, MAX_PAYLOAD_ROWS), total_rows: obj.rows.length };
    }
    return obj;
  }
  return raw;
}

/** Best-effort lookup of a client id from its name, so member RLS can see the event. */
async function resolveClientIdByName(
  supabase: SupabaseClient,
  name: string | null
): Promise<number | null> {
  if (!name) return null;
  try {
    const lookup = await lookupClientByName(supabase, name);
    if (lookup.error || !lookup.data) return null;
    const id = Number(lookup.data.id);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

/** Derive a "rows affected" count from a success response body. */
function deriveAffected(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.confirmed === 'number') return b.confirmed;
  if (typeof b.updated === 'number') return b.updated;
  if (typeof b.created === 'number') return b.created;
  if (typeof b.inferred_empty === 'number') return b.inferred_empty;
  if (typeof b.reverted === 'number') return b.reverted;
  // unified-confirm shape: { non_metered: { confirmed }, metered: { confirmed } }
  const nm = (b.non_metered as { confirmed?: unknown } | undefined)?.confirmed;
  const m = (b.metered as { confirmed?: unknown } | undefined)?.confirmed;
  if (typeof nm === 'number' || typeof m === 'number') {
    return (typeof nm === 'number' ? nm : 0) + (typeof m === 'number' ? m : 0);
  }
  // pending bulk shape: { non_metered: { summary: { created } }, metered: { created } }
  const nmCreated = (b.non_metered as { summary?: { created?: unknown } } | undefined)?.summary
    ?.created;
  const mCreated = (b.metered as { created?: unknown } | undefined)?.created;
  if (typeof nmCreated === 'number' || typeof mCreated === 'number') {
    return (typeof nmCreated === 'number' ? nmCreated : 0) + (typeof mCreated === 'number' ? mCreated : 0);
  }
  return null;
}

/** Best-effort insert into ingestion_events. Never throws. */
export async function logIngestionEvent(
  supabase: SupabaseClient,
  event: IngestionEventInput
): Promise<void> {
  try {
    const client_id =
      event.client_id ?? (await resolveClientIdByName(supabase, event.client_name ?? null));
    await supabase.from('ingestion_events').insert({
      endpoint: event.endpoint,
      outcome: event.outcome,
      scope_kind: event.scope_kind ?? null,
      group_id: event.group_id ?? null,
      client_id,
      client_name: event.client_name ?? null,
      supplier_name: event.supplier_name ?? null,
      facility_name: event.facility_name ?? null,
      utility_name: event.utility_name ?? null,
      period_start: event.period_start ?? null,
      reason: event.reason ?? null,
      http_status: event.http_status ?? null,
      affected_count: event.affected_count ?? null,
      payload_excerpt: (event.payload_excerpt ?? null) as never,
      duration_ms: event.duration_ms ?? null,
    });
  } catch (err) {
    console.error('logIngestionEvent failed (non-fatal):', err);
  }
}

/**
 * Log an ingestion event derived from the handler's NextResponse.
 * Outcome is SUCCESS for 2xx/3xx, FAILURE otherwise; the failure reason is read
 * from the response body's `error`/`detail` fields. Used by the confirm routes.
 */
export async function logIngestionFromResponse(
  supabase: SupabaseClient,
  opts: {
    endpoint: string;
    scopeKind?: string | null;
    request: unknown;
    response: NextResponse;
    startedAt: number;
  }
): Promise<void> {
  const status = opts.response.status;
  let body: unknown = null;
  try {
    body = await opts.response.clone().json();
  } catch {
    body = null;
  }

  const outcome: IngestionOutcome = status >= 200 && status < 400 ? 'SUCCESS' : 'FAILURE';

  let reason: string | null = null;
  if (outcome === 'FAILURE' && body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const err = str(b.error);
    const detail = str(b.detail);
    reason = err && detail ? `${err}: ${detail}` : err ?? detail;
  }

  const identity = extractIdentity(opts.request);

  await logIngestionEvent(supabase, {
    endpoint: opts.endpoint,
    outcome,
    scope_kind: opts.scopeKind ?? null,
    reason,
    http_status: status,
    affected_count: outcome === 'SUCCESS' ? deriveAffected(body) : null,
    payload_excerpt: trimPayload(opts.request),
    duration_ms: Date.now() - opts.startedAt,
    ...identity,
  });
}

/**
 * Log an event for the /error endpoints. These are the automation telling us an upstream
 * ingestion (typically a confirm) failed, so they are recorded as FAILURE events carrying
 * the supplied reason — even though the DB status-flip itself may have succeeded.
 */
export async function logIngestionErrorReport(
  supabase: SupabaseClient,
  opts: {
    endpoint: string;
    scopeKind?: string | null;
    groupId?: number | null;
    request: unknown;
    response: NextResponse;
    startedAt: number;
  }
): Promise<void> {
  const status = opts.response.status;
  let body: unknown = null;
  try {
    body = await opts.response.clone().json();
  } catch {
    body = null;
  }

  const reqObj =
    opts.request && typeof opts.request === 'object'
      ? (opts.request as Record<string, unknown>)
      : {};
  const suppliedReason = str(reqObj.reason);

  // If the DB flip itself errored, prefer that detail; otherwise use the supplied reason.
  let reason: string | null = suppliedReason;
  if (status >= 400 && body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const err = str(b.error);
    const detail = str(b.detail);
    const respReason = err && detail ? `${err}: ${detail}` : err ?? detail;
    reason = respReason ?? suppliedReason ?? null;
  }
  if (!reason) {
    reason = 'Ingestion reported an error (no reason provided)';
  }

  const affected =
    body && typeof body === 'object' && typeof (body as Record<string, unknown>).updated === 'number'
      ? ((body as Record<string, unknown>).updated as number)
      : null;

  const identity = extractIdentity(opts.request);

  await logIngestionEvent(supabase, {
    endpoint: opts.endpoint,
    outcome: 'FAILURE',
    scope_kind: opts.scopeKind ?? null,
    group_id: opts.groupId ?? null,
    reason,
    http_status: status,
    affected_count: affected,
    payload_excerpt: trimPayload(opts.request),
    duration_ms: Date.now() - opts.startedAt,
    ...identity,
  });
}
