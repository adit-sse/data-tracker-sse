import type { SupabaseClient } from '@supabase/supabase-js';
import type { IdentifierType } from '@/types';
import { resolveIngestionScope } from '@/lib/ingestion-line';
import { lookupFacilityByName } from '@/lib/name-lookup';
import { idKey, sameId, type RowId } from '@/lib/row-id';
import { identifierLookupCandidates } from '@/lib/nmi';

/** Invoice rows that already “cover” a month — do not seed metered PENDING over these. */
export const METERED_GREEN_INVOICE_STATUSES = [
  'CONFIRMED',
  'DEACTIVATED',
] as const;

export type NgersMeterRow = Record<string, unknown>;

/** Earliest actual_invoices.period_start_date (YYYY-MM-DD) for a meter, or null if none. */
export async function earliestMeterMonthStart(
  supabase: SupabaseClient,
  meterId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('actual_invoices')
    .select('period_start_date')
    .eq('meter_id', meterId)
    .order('period_start_date', { ascending: true })
    .limit(1);
  const first = (data ?? [])[0]?.period_start_date;
  return typeof first === 'string' ? first.slice(0, 10) : null;
}

/** Normalize cell values from CSV (string) or JSON APIs (often number for NMIs / account #s). */
function meterIdCell(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v).trim();
  return '';
}

/** Pick NMI / MIRN / Account / Meter id from a NGERS-style row (same precedence as CSV upload). */
export function parseMeterIdentifierFromNgersRow(
  row: NgersMeterRow
): { ok: true; identifier_type: IdentifierType; lookup1: string; lookup2: string | null } | { ok: false; error: string } {
  const inputType =
    typeof row['Input Type'] === 'string' ? (row['Input Type'] as string).trim() || null : null;

  const nmi = meterIdCell(row.NMI);
  if (nmi) {
    return { ok: true, identifier_type: 'NMI', lookup1: nmi, lookup2: inputType };
  }
  const mirn = meterIdCell(row.MIRN);
  if (mirn) {
    return { ok: true, identifier_type: 'MIRN', lookup1: mirn, lookup2: inputType };
  }
  const acct = meterIdCell(row['Account Number']);
  if (acct) {
    return { ok: true, identifier_type: 'ACCOUNT_NUMBER', lookup1: acct, lookup2: inputType };
  }
  const meterNum = meterIdCell(row['Meter Number']);
  if (meterNum) {
    return { ok: true, identifier_type: 'METER_NUMBER', lookup1: meterNum, lookup2: inputType };
  }
  return { ok: false, error: 'Row needs NMI, MIRN, Account Number, or Meter Number' };
}

type MeterMatch = {
  id: string | number;
  facility_id: RowId;
  supplier_id: RowId;
  identifier_type: string | null;
  lookup1: string | null;
};

const METER_MATCH_COLUMNS = 'id, facility_id, supplier_id, identifier_type, lookup1';

/** Supplier names by id, for error messages only. One query for any number of ids. */
async function supplierNamesByIds(
  supabase: SupabaseClient,
  supplierIds: RowId[]
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(supplierIds.filter((id) => id !== null).map(idKey)));
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from('suppliers').select('id, name').in('id', ids);
  const byId = new Map<string, string>();
  for (const row of (data ?? []) as { id: RowId; name: string | null }[]) {
    if (row.name?.trim()) byId.set(idKey(row.id), row.name.trim());
  }
  return byId;
}

/** Render a supplier id as a name for error text, falling back to the raw id. */
function supplierLabel(supplierId: RowId, byId: Map<string, string>): string {
  if (supplierId === null) return '(none)';
  return byId.get(idKey(supplierId)) ?? `(unknown supplier id ${supplierId})`;
}

/** Render a facility id as a name for error text, falling back to the raw id. */
function facilityLabel(facilityId: RowId, byId: Map<string, string>): string {
  if (facilityId === null) return '(none)';
  return byId.get(idKey(facilityId)) ?? `(unknown facility id ${facilityId})`;
}

/** One-line description of a meter row for error text. */
function describeMeter(
  meter: MeterMatch,
  byId: Map<string, string>,
  facilitiesById: Map<string, string>
): string {
  return (
    `identifier ${meter.identifier_type ?? '(none)'} ${meter.lookup1 ?? '(none)'}, ` +
    `supplier "${supplierLabel(meter.supplier_id, byId)}", ` +
    `facility "${facilityLabel(meter.facility_id, facilitiesById)}" (meter id ${meter.id})`
  );
}

/**
 * Build the 409 for an identifier that matched more than one meter.
 *
 * Two different causes, two different repairs: the same identifier stored twice in
 * different forms at one site is a duplicate to delete, whereas matches spread over
 * several facilities just need `facility_name` to disambiguate.
 */
async function ambiguousMeterError(
  supabase: SupabaseClient,
  matches: MeterMatch[],
  facilitiesById: Map<string, string>,
  kind: 'exact' | 'loose',
  params: { identifierType: IdentifierType; utilityName: string; clientName: string },
  lookup1: string
): Promise<{ ok: false; error: string; status: number }> {
  const shown = matches.slice(0, 5);
  const supplierNames = await supplierNamesByIds(
    supabase,
    shown.map((m) => m.supplier_id)
  );
  const list =
    shown.map((m, i) => `[${i + 1}] ${describeMeter(m, supplierNames, facilitiesById)}`).join('; ') +
    (matches.length > shown.length ? ', …and more' : '');

  const distinctFacilities = new Set(matches.map((m) => idKey(m.facility_id)));
  if (distinctFacilities.size > 1) {
    return {
      ok: false,
      error:
        `Identifier ${params.identifierType} ${lookup1} for "${params.utilityName}" matches meters at ` +
        `${distinctFacilities.size} facilities of client "${params.clientName}": ${list}. ` +
        'Pass facility_name to say which site this row is for.',
      status: 409,
    };
  }

  if (kind === 'exact') {
    return {
      ok: false,
      error:
        `Two meters at facility "${facilityLabel(matches[0].facility_id, facilitiesById)}" hold the same ` +
        `identifier in different forms (an NMI with and without its checksum digit): ${list}. ` +
        'These are one meter recorded twice — delete the duplicate, keeping whichever has the invoice history.',
      status: 409,
    };
  }

  return {
    ok: false,
    error:
      `Multiple meters match lookup1 ${lookup1} at facility ` +
      `"${facilityLabel(matches[0].facility_id, facilitiesById)}" for "${params.utilityName}"; ` +
      `set a unique identifier_type on the meter. Matched: ${list}. ` +
      `Row supplied: identifier ${params.identifierType} ${lookup1}.`,
    status: 409,
  };
}

export async function resolveMeterForIngestion(
  supabase: SupabaseClient,
  params: {
    clientName: string;
    facilityName: string;
    supplierName: string;
    utilityName: string;
    identifierType: IdentifierType;
    lookup1: string;
    lookup2?: string | null;
  }
): Promise<
  | { ok: true; meterId: string }
  | { ok: false; error: string; status: number }
> {
  const resolvedScope = await resolveIngestionScope(
    supabase,
    params.clientName,
    params.supplierName,
    params.utilityName
  );
  if (!resolvedScope.ok) return resolvedScope;
  const scope = resolvedScope.scope;

  // Checked before any facility work: a non-metered utility should be told so
  // plainly rather than failing later on a meter search that was never going to match.
  if (!scope.isMetered) {
    return {
      ok: false,
      error: `Input type "${params.utilityName}" is not marked metered — use non-metered ingestion instead`,
      status: 422,
    };
  }

  const lookup1 = params.lookup1.trim();
  if (!lookup1) {
    return { ok: false, error: 'lookup1 / identifier is required', status: 400 };
  }

  // Facility scope for the search. A named facility narrows it; without one, search
  // every facility of the client and let the identifier pick the meter. The identifier
  // is the stronger key — a NMI names one meter nationally — and the meter row already
  // records which facility it sits at, so facility_name is genuinely optional here.
  const facilitiesById = new Map<string, string>();
  const facilityIds: string[] = [];
  const facTrimmed = typeof params.facilityName === 'string' ? params.facilityName.trim() : '';

  if (facTrimmed) {
    const facilityLookup = await lookupFacilityByName(supabase, facTrimmed, scope.clientId);
    if (facilityLookup.error) {
      return { ok: false, error: facilityLookup.error, status: 500 };
    }
    if (!facilityLookup.data) {
      return {
        ok: false,
        error: `Facility "${params.facilityName}" not found for client "${params.clientName}"`,
        status: 404,
      };
    }
    facilityIds.push(idKey(facilityLookup.data.id));
    facilitiesById.set(idKey(facilityLookup.data.id), facilityLookup.data.name);
  } else {
    const { data: rows, error: facErr } = await supabase
      .from('facilities')
      .select('id, name')
      .eq('client_id', scope.clientId);

    if (facErr) {
      return { ok: false, error: facErr.message, status: 500 };
    }
    for (const f of (rows ?? []) as { id: RowId; name: string }[]) {
      facilityIds.push(idKey(f.id));
      facilitiesById.set(idKey(f.id), f.name);
    }
    if (facilityIds.length === 0) {
      return {
        ok: false,
        error: `No facilities found for client "${params.clientName}"`,
        status: 404,
      };
    }
  }

  // A NMI is stored either with or without its trailing checksum digit, and
  // source data uses both forms for the same meter. Match on every form the
  // value could legitimately take. Other identifier types resolve to just
  // themselves — see lib/nmi.ts.
  const lookupCandidates = identifierLookupCandidates(params.identifierType, lookup1);

  const { data: exactRows } = await supabase
    .from('meters')
    .select(METER_MATCH_COLUMNS)
    .in('facility_id', facilityIds)
    .eq('input_type_id', scope.inputTypeId)
    .in('lookup1', lookupCandidates)
    .eq('identifier_type', params.identifierType)
    .limit(6);

  // Several matches — never pick one silently, since a wrong choice splits or
  // misfiles consumption with no visible symptom.
  if ((exactRows?.length ?? 0) > 1) {
    return ambiguousMeterError(
      supabase,
      (exactRows ?? []) as MeterMatch[],
      facilitiesById,
      'exact',
      params,
      lookup1
    );
  }

  let meter = exactRows?.[0] as MeterMatch | undefined;

  if (!meter) {
    const { data: looseRows } = await supabase
      .from('meters')
      .select(METER_MATCH_COLUMNS)
      .in('facility_id', facilityIds)
      .eq('input_type_id', scope.inputTypeId)
      .in('lookup1', lookupCandidates)
      .limit(6);

    if ((looseRows?.length ?? 0) > 1) {
      return ambiguousMeterError(
        supabase,
        (looseRows ?? []) as MeterMatch[],
        facilitiesById,
        'loose',
        params,
        lookup1
      );
    }
    meter = looseRows?.[0] as MeterMatch | undefined;
  }

  if (!meter) {
    const where = facTrimmed
      ? `at facility "${facTrimmed}"`
      : `across the ${facilityIds.length} facility/facilities of client "${params.clientName}"`;
    return {
      ok: false,
      error:
        `No meter found for "${params.utilityName}" with identifier ${params.identifierType} ${lookup1} ` +
        `${where}. Create the meter in the tracker first.`,
      status: 404,
    };
  }

  if (meter.supplier_id !== null && !sameId(meter.supplier_id, scope.supplierId)) {
    const supplierNames = await supplierNamesByIds(supabase, [meter.supplier_id]);
    return {
      ok: false,
      error:
        'Meter exists but is linked to a different supplier than Provider / supplier_name. ' +
        `Matched meter: ${describeMeter(meter, supplierNames, facilitiesById)}. ` +
        `Row supplied: identifier ${params.identifierType} ${lookup1}, ` +
        `facility "${facTrimmed || '(not supplied)'}", supplier "${params.supplierName}". ` +
        'Either correct Provider / supplier_name on the row, or update the meter\'s supplier in the tracker.',
      status: 409,
    };
  }

  const lookup2 = params.lookup2?.trim() || null;
  if (lookup2) {
    const { data: m2 } = await supabase
      .from('meters')
      .select('lookup2')
      .eq('id', meter.id)
      .single();
    const dbL2 = m2?.lookup2?.trim() || null;
    if (dbL2 && dbL2 !== lookup2) {
      const supplierNames = await supplierNamesByIds(supabase, [meter.supplier_id]);
      return {
        ok: false,
        error:
          'Meter lookup2 (network / region) does not match row Input Type. ' +
          `Matched meter: ${describeMeter(meter, supplierNames, facilitiesById)}, ` +
          `lookup2 "${dbL2}". ` +
          `Row supplied: identifier ${params.identifierType} ${lookup1}, ` +
          `facility "${facTrimmed || '(not supplied)'}", supplier "${params.supplierName}", ` +
          `Input Type / lookup2 "${lookup2}". ` +
          'Either correct the row\'s Input Type, or update the meter\'s lookup2 in the tracker.',
        status: 409,
      };
    }
  }

  return { ok: true, meterId: idKey(meter.id) };
}

/**
 * True if the calendar month slot should block a new PENDING row.
 *
 * Blocks when:
 *   - A PENDING row already exists for this month (no duplicate pending needed)
 *   - A DEACTIVATED row exists (meter was off, no invoice expected)
 *   - Green invoices (CONFIRMED/IMPORTED/MANUAL_ENTRY) fully cover every day of the month
 *
 * Does NOT block when green invoices only partially cover the month — a PENDING row
 * is still created so the workflow knows more invoices may be outstanding.
 * ERROR rows also do not block, allowing a retry via pending.
 */
export async function meterMonthBlocksNewPending(
  supabase: SupabaseClient,
  meterId: string,
  monthStart: string,
  monthEnd: string
): Promise<boolean> {
  // Hard block: already pending or deactivated
  const { data: hardRows } = await supabase
    .from('actual_invoices')
    .select('id')
    .eq('meter_id', meterId)
    .lte('period_start_date', monthEnd)
    .gte('period_end_date', monthStart)
    .in('status', ['PENDING', 'DEACTIVATED']);

  if ((hardRows?.length ?? 0) > 0) return true;

  // Soft block: green records exist — only block if they fully cover every day
  const { data: greenRows } = await supabase
    .from('actual_invoices')
    .select('period_start_date, period_end_date')
    .eq('meter_id', meterId)
    .lte('period_start_date', monthEnd)
    .gte('period_end_date', monthStart)
    .in('status', [...METERED_GREEN_INVOICE_STATUSES]);

  if (!greenRows || greenRows.length === 0) return false;

  const mStart = new Date(monthStart);
  const mEnd = new Date(monthEnd);
  const totalDays =
    Math.round((mEnd.getTime() - mStart.getTime()) / 86_400_000) + 1;
  const coveredDays = new Set<string>();

  for (const row of greenRows) {
    const start = new Date(
      Math.max(new Date(row.period_start_date as string).getTime(), mStart.getTime())
    );
    const end = new Date(
      Math.min(new Date(row.period_end_date as string).getTime(), mEnd.getTime())
    );
    const cur = new Date(start);
    while (cur <= end) {
      coveredDays.add(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
  }

  return coveredDays.size >= totalDays;
}

/** True if any “green” invoice overlaps [start, end] (used when inserting a confirmed row without a prior PENDING). */
export async function meteredPeriodHasGreenOverlap(
  supabase: SupabaseClient,
  meterId: string,
  periodStart: string,
  periodEnd: string
): Promise<boolean> {
  const { data: rows } = await supabase
    .from('actual_invoices')
    .select('id')
    .eq('meter_id', meterId)
    .lte('period_start_date', periodEnd)
    .gte('period_end_date', periodStart)
    .in('status', [...METERED_GREEN_INVOICE_STATUSES]);

  return (rows?.length ?? 0) > 0;
}

/**
 * True if an exact-match green invoice already exists for this meter and period.
 * Prevents submitting the identical invoice twice while still allowing
 * legitimately overlapping invoices (e.g. Mar 16-Apr 16 and Apr 1-Apr 30).
 */
export async function meteredExactDuplicateExists(
  supabase: SupabaseClient,
  meterId: string,
  periodStart: string,
  periodEnd: string
): Promise<boolean> {
  const { data: rows } = await supabase
    .from('actual_invoices')
    .select('id')
    .eq('meter_id', meterId)
    .eq('period_start_date', periodStart)
    .eq('period_end_date', periodEnd)
    .in('status', [...METERED_GREEN_INVOICE_STATUSES]);

  return (rows?.length ?? 0) > 0;
}

/**
 * In-memory equivalent of meterMonthBlocksNewPending.
 * Operates against rows already fetched for a single meter (no DB call).
 */
export function meterMonthBlocksNewPendingFromCache(
  rows: Array<{ period_start_date: string; period_end_date: string; status: string | null }>,
  monthStart: string,
  monthEnd: string
): boolean {
  const overlapping = rows.filter(
    (r) => r.period_start_date <= monthEnd && r.period_end_date >= monthStart
  );

  // Hard block: PENDING or DEACTIVATED already overlaps this month
  if (overlapping.some((r) => r.status === 'PENDING' || r.status === 'DEACTIVATED')) return true;

  // Soft block: green records fully cover every day of the month
  const greenRows = overlapping.filter((r) =>
    (METERED_GREEN_INVOICE_STATUSES as readonly string[]).includes(r.status ?? '')
  );
  if (greenRows.length === 0) return false;

  const mStart = new Date(monthStart);
  const mEnd = new Date(monthEnd);
  const totalDays = Math.round((mEnd.getTime() - mStart.getTime()) / 86_400_000) + 1;
  const coveredDays = new Set<string>();

  for (const row of greenRows) {
    const start = new Date(
      Math.max(new Date(row.period_start_date).getTime(), mStart.getTime())
    );
    const end = new Date(
      Math.min(new Date(row.period_end_date).getTime(), mEnd.getTime())
    );
    const cur = new Date(start);
    while (cur <= end) {
      coveredDays.add(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
  }

  return coveredDays.size >= totalDays;
}

/**
 * Pre-fetch all actual_invoices for a set of meters covering [rangeStart, rangeEnd] in a
 * single pass (chunked by 200 meter IDs to stay within PostgREST's IN limit).
 *
 * Returns a Map<meterId, invoiceRows> for use with meterMonthBlocksNewPendingFromCache,
 * replacing the per-meter × per-month DB calls in seedMeteredPending.
 */
export async function bulkFetchMeterInvoicesForMonths(
  supabase: SupabaseClient,
  meterIds: string[],
  rangeStart: string,
  rangeEnd: string
): Promise<Map<string, Array<{ period_start_date: string; period_end_date: string; status: string | null }>>> {
  const cache = new Map<
    string,
    Array<{ period_start_date: string; period_end_date: string; status: string | null }>
  >();
  if (meterIds.length === 0) return cache;

  const CHUNK = 200;
  const chunks: string[][] = [];
  for (let i = 0; i < meterIds.length; i += CHUNK) {
    chunks.push(meterIds.slice(i, i + CHUNK));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from('actual_invoices')
        .select('meter_id, period_start_date, period_end_date, status')
        .in('meter_id', chunk)
        .lte('period_start_date', rangeEnd)
        .gte('period_end_date', rangeStart)
        .limit(50000)
    )
  );

  for (const { data, error } of results) {
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const mid = String(row.meter_id);
      if (!cache.has(mid)) cache.set(mid, []);
      cache.get(mid)!.push({
        period_start_date: row.period_start_date as string,
        period_end_date: row.period_end_date as string,
        status: row.status as string | null,
      });
    }
  }

  return cache;
}

