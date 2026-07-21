/**
 * Shared error-state transition logic for ingestion.
 *
 * Flips PENDING rows → ERROR for a single calendar month (taken from the start
 * of `date_range`). CONFIRMED / INFERRED_EMPTY / other rows are never touched —
 * only PENDING placeholders get marked ERROR.
 *
 * Exports:
 *   markMeteredError      — actual_invoices path (one specific meter)
 *   markNonMeteredError   — non_metered_records path (facility group or standalone line)
 *
 * Routes are thin adapters: parse request → call these → map result to NextResponse.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveIngestionLine } from '@/lib/ingestion-line';
import { lookupClientAndSupplier } from '@/lib/name-lookup';
import { resolveMeterForIngestion } from '@/lib/ingestion-metered';
import { parseNgersDateRange, monthStartIso } from '@/lib/ingestion-dates';
import type { IdentifierType } from '@/types';

export type ErrorScope = 'metered' | 'group' | 'line';

export interface MeteredErrorTarget {
  client_name: string;
  supplier_name: string;
  utility_name: string;
  facility_name?: string;
  identifier_type: IdentifierType;
  lookup1: string;
  lookup2?: string | null;
  date_range: string;
}

export interface NonMeteredErrorTarget {
  client_name: string;
  supplier_name: string;
  utility_name: string;
  date_range: string;
  /** Pass "line" for a standalone non-metered line; omit for a facility group. */
  mode?: string;
  facility_name?: string;
}

export type MarkErrorOk = {
  ok: true;
  scope: ErrorScope;
  updated: number;
  periodStart: string;
  groupId?: number | null;
  meterId?: string;
};
export type MarkErrorErr = { ok: false; error: string; status: number };
export type MarkErrorResult = MarkErrorOk | MarkErrorErr;

const IDENTIFIER_TYPES: readonly IdentifierType[] = [
  'NMI',
  'MIRN',
  'ACCOUNT_NUMBER',
  'METER_NUMBER',
  'REGISTRATION_PLATE',
  'CARD_NUMBER',
  'FACILITY_LEVEL',
  'DESCRIPTION',
] as const;

function pendingIds(rows: { id: string }[] | null): string[] {
  return (rows ?? []).map((r) => r.id);
}

/** Mark the PENDING actual_invoices row for one meter + month as ERROR. */
export async function markMeteredError(
  supabase: SupabaseClient,
  t: MeteredErrorTarget
): Promise<MarkErrorResult> {
  if (!t.client_name || !t.supplier_name || !t.utility_name || !t.date_range) {
    return {
      ok: false,
      error: 'client_name, supplier_name, utility_name, and date_range are required',
      status: 400,
    };
  }
  if (!t.identifier_type || !t.lookup1) {
    return { ok: false, error: 'identifier_type and lookup1 are required', status: 400 };
  }
  if (!IDENTIFIER_TYPES.includes(t.identifier_type)) {
    return { ok: false, error: `Invalid identifier_type: ${t.identifier_type}`, status: 400 };
  }

  const parsed = parseNgersDateRange(t.date_range);
  if (!parsed) {
    return { ok: false, error: 'date_range must be "DD/MM/YYYY - DD/MM/YYYY"', status: 400 };
  }
  const periodStart = monthStartIso(parsed.start);

  const facilityNameStr = typeof t.facility_name === 'string' ? t.facility_name.trim() : '';
  const resolved = await resolveMeterForIngestion(supabase, {
    clientName: t.client_name,
    facilityName: facilityNameStr,
    supplierName: t.supplier_name,
    utilityName: t.utility_name,
    identifierType: t.identifier_type,
    lookup1: t.lookup1,
    lookup2: t.lookup2 ?? null,
  });
  if (!resolved.ok) return { ok: false, error: resolved.error, status: resolved.status };

  const { data: pendingRows, error: fetchError } = await supabase
    .from('actual_invoices')
    .select('id')
    .eq('meter_id', resolved.meterId)
    .eq('period_start_date', periodStart)
    .eq('status', 'PENDING');
  if (fetchError) throw new Error(fetchError.message);

  const ids = pendingIds(pendingRows);
  if (ids.length === 0) {
    return { ok: true, scope: 'metered', updated: 0, periodStart, meterId: resolved.meterId };
  }

  const { error: updateError } = await supabase
    .from('actual_invoices')
    .update({ status: 'ERROR' })
    .in('id', ids);
  if (updateError) throw new Error(updateError.message);

  return { ok: true, scope: 'metered', updated: ids.length, periodStart, meterId: resolved.meterId };
}

/** Mark PENDING non_metered_records as ERROR for a facility group or standalone line. */
export async function markNonMeteredError(
  supabase: SupabaseClient,
  t: NonMeteredErrorTarget
): Promise<MarkErrorResult> {
  if (!t.client_name || !t.supplier_name || !t.utility_name || !t.date_range) {
    return {
      ok: false,
      error: 'client_name, supplier_name, utility_name, and date_range are required',
      status: 400,
    };
  }

  const parsed = parseNgersDateRange(t.date_range);
  if (!parsed) {
    return { ok: false, error: 'date_range must be "DD/MM/YYYY - DD/MM/YYYY"', status: 400 };
  }
  const periodStart = monthStartIso(parsed.start);

  // ── Standalone line ──────────────────────────────────────────────────────────
  if (t.mode === 'line') {
    const resolved = await resolveIngestionLine(
      supabase,
      t.client_name,
      typeof t.facility_name === 'string' ? t.facility_name.trim() : '',
      t.supplier_name,
      t.utility_name
    );
    if (!resolved.ok) return { ok: false, error: resolved.error, status: resolved.status };

    const { facilityId, supplierId, categoryId } = resolved;

    // Look up whether this line belongs to a facility group, so the event can be tagged.
    const { data: nmLine } = await supabase
      .from('non_metered_lines')
      .select('id, facility_group_members(group_id)')
      .eq('facility_id', facilityId)
      .eq('supplier_id', supplierId)
      .eq('input_type_id', categoryId)
      .maybeSingle();
    const groupId =
      (nmLine as { facility_group_members?: { group_id: number }[] } | null)
        ?.facility_group_members?.[0]?.group_id ?? null;

    const { data: pendingRows, error: fetchError } = await supabase
      .from('non_metered_records')
      .select('id')
      .eq('facility_id', facilityId)
      .eq('supplier_id', supplierId)
      .eq('input_type_id', categoryId)
      .eq('period_start_date', periodStart)
      .eq('status', 'PENDING');
    if (fetchError) throw new Error(fetchError.message);

    const ids = pendingIds(pendingRows);
    if (ids.length === 0) {
      return { ok: true, scope: 'line', updated: 0, periodStart, groupId };
    }

    const { error: updateError } = await supabase
      .from('non_metered_records')
      .update({ status: 'ERROR' })
      .in('id', ids);
    if (updateError) throw new Error(updateError.message);

    return { ok: true, scope: 'line', updated: ids.length, periodStart, groupId };
  }

  // ── Facility group ───────────────────────────────────────────────────────────
  const [clientSupplier, { data: groupCategory }] = await Promise.all([
    lookupClientAndSupplier(supabase, t.client_name, t.supplier_name),
    supabase.from('categories').select('id').ilike('name', t.utility_name).single(),
  ]);

  if (!clientSupplier.ok) {
    return { ok: false, error: clientSupplier.error, status: clientSupplier.status };
  }
  const { client, supplier } = clientSupplier;
  if (!groupCategory) {
    return { ok: false, error: `Category "${t.utility_name}" not found`, status: 404 };
  }

  const { data: group } = await supabase
    .from('facility_groups')
    .select(`
      id,
      members:facility_group_members(
        line:non_metered_lines(facility_id, input_type_id)
      )
    `)
    .eq('client_id', client.id)
    .eq('supplier_id', supplier.id)
    .eq('category_id', groupCategory.id)
    .single();

  if (!group) {
    return {
      ok: false,
      error: `No group configured for client "${t.client_name}", supplier "${t.supplier_name}", utility type "${t.utility_name}".`,
      status: 404,
    };
  }

  type MemberRow = { facility_id: string; input_type_id: string };
  const members: MemberRow[] = ((group.members ?? []) as unknown[])
    .map((m: unknown) => {
      const row = m as { line?: { facility_id?: string; input_type_id?: string } };
      return { facility_id: row.line?.facility_id, input_type_id: row.line?.input_type_id };
    })
    .filter((m): m is MemberRow => !!m.facility_id && !!m.input_type_id);

  if (members.length === 0) {
    return { ok: false, error: 'Group has no members with input types', status: 422 };
  }

  const facilityIds = members.map((m) => m.facility_id);
  const categoryIds = Array.from(new Set(members.map((m) => m.input_type_id)));

  const { data: pendingRows, error: fetchError } = await supabase
    .from('non_metered_records')
    .select('id')
    .in('facility_id', facilityIds)
    .eq('supplier_id', supplier.id)
    .in('input_type_id', categoryIds)
    .eq('period_start_date', periodStart)
    .eq('status', 'PENDING');
  if (fetchError) throw new Error(fetchError.message);

  const ids = pendingIds(pendingRows);
  if (ids.length === 0) {
    return { ok: true, scope: 'group', updated: 0, periodStart, groupId: group.id as number };
  }

  const { error: updateError } = await supabase
    .from('non_metered_records')
    .update({ status: 'ERROR' })
    .in('id', ids);
  if (updateError) throw new Error(updateError.message);

  return { ok: true, scope: 'group', updated: ids.length, periodStart, groupId: group.id as number };
}
