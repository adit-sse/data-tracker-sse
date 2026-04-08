import type { SupabaseClient } from '@supabase/supabase-js';
import type { IdentifierType } from '@/types';
import { resolveIngestionLine } from '@/lib/ingestion-line';

/** Invoice rows that already “cover” a month — do not seed metered PENDING over these. */
export const METERED_GREEN_INVOICE_STATUSES = [
  'IMPORTED',
  'MANUAL_ENTRY',
  'CONFIRMED',
  'DEACTIVATED',
] as const;

export type NgersMeterRow = Record<string, unknown>;

/** Pick NMI / MIRN / Account / Meter id from a NGERS-style row (same precedence as CSV upload). */
export function parseMeterIdentifierFromNgersRow(
  row: NgersMeterRow
): { ok: true; identifier_type: IdentifierType; lookup1: string; lookup2: string | null } | { ok: false; error: string } {
  const inputType =
    typeof row['Input Type'] === 'string' ? (row['Input Type'] as string).trim() || null : null;

  const nmi = typeof row.NMI === 'string' ? row.NMI.trim() : '';
  if (nmi) {
    return { ok: true, identifier_type: 'NMI', lookup1: nmi, lookup2: inputType };
  }
  const mirn = typeof row.MIRN === 'string' ? row.MIRN.trim() : '';
  if (mirn) {
    return { ok: true, identifier_type: 'MIRN', lookup1: mirn, lookup2: inputType };
  }
  const acct =
    typeof row['Account Number'] === 'string' ? (row['Account Number'] as string).trim() : '';
  if (acct) {
    return { ok: true, identifier_type: 'ACCOUNT_NUMBER', lookup1: acct, lookup2: inputType };
  }
  const meterNum =
    typeof row['Meter Number'] === 'string' ? (row['Meter Number'] as string).trim() : '';
  if (meterNum) {
    return { ok: true, identifier_type: 'METER_NUMBER', lookup1: meterNum, lookup2: inputType };
  }
  return { ok: false, error: 'Row needs NMI, MIRN, Account Number, or Meter Number' };
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
  const line = await resolveIngestionLine(
    supabase,
    params.clientName,
    params.facilityName,
    params.supplierName,
    params.utilityName
  );
  if (!line.ok) return line;

  const { data: inputType, error: catErr } = await supabase
    .from('input_types')
    .select('is_metered')
    .eq('id', line.categoryId)
    .single();

  if (catErr || !inputType) {
    return { ok: false, error: 'Input type not found', status: 404 };
  }
  if (!inputType.is_metered) {
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

  let query = supabase
    .from('meters')
    .select('id, supplier_id')
    .eq('facility_id', line.facilityId)
    .eq('input_type_id', line.categoryId)
    .eq('lookup1', lookup1);

  const { data: exactRows } = await query
    .eq('identifier_type', params.identifierType)
    .limit(1);

  let meter = exactRows?.[0] as { id: string; supplier_id: string | null } | undefined;

  if (!meter) {
    const { data: looseRows } = await supabase
      .from('meters')
      .select('id, supplier_id')
      .eq('facility_id', line.facilityId)
      .eq('input_type_id', line.categoryId)
      .eq('lookup1', lookup1)
      .limit(2);

    if ((looseRows?.length ?? 0) > 1) {
      return {
        ok: false,
        error: 'Multiple meters match this lookup1; set a unique identifier_type on the meter',
        status: 409,
      };
    }
    meter = looseRows?.[0] as { id: string; supplier_id: string | null } | undefined;
  }

  if (!meter) {
    return {
      ok: false,
      error: `No meter found for facility + "${params.utilityName}" with identifier ${params.identifierType} ${lookup1}. Create the meter in the tracker first.`,
      status: 404,
    };
  }

  if (meter.supplier_id && meter.supplier_id !== line.supplierId) {
    return {
      ok: false,
      error: 'Meter exists but is linked to a different supplier than Provider / supplier_name',
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
      return {
        ok: false,
        error: 'Meter lookup2 (network / region) does not match row Input Type',
        status: 409,
      };
    }
  }

  return { ok: true, meterId: meter.id };
}

/** True if the calendar month slot is already taken (green data, placeholder PENDING, or ERROR). */
export async function meterMonthBlocksNewPending(
  supabase: SupabaseClient,
  meterId: string,
  monthStart: string,
  monthEnd: string
): Promise<boolean> {
  const blockingStatuses = [...METERED_GREEN_INVOICE_STATUSES, 'PENDING', 'ERROR'];
  const { data: rows } = await supabase
    .from('actual_invoices')
    .select('id')
    .eq('meter_id', meterId)
    .lte('period_start_date', monthEnd)
    .gte('period_end_date', monthStart)
    .in('status', blockingStatuses);

  return (rows?.length ?? 0) > 0;
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
