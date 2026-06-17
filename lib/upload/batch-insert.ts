/**
 * lib/upload/batch-insert.ts
 *
 * Batch writers for both metered invoices and non-metered records.
 *
 * batchInsertInvoices  — deduplicates against existing DB rows then inserts in chunks.
 * processNonMeteredBatch — deduplicates within the batch, upserts in chunks,
 *                          then triggers auto-group creation and inference backfill.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { upsertNonMeteredLines } from '@/lib/non-metered-lines';
import { autoCreateNonMeteredGroups } from '@/lib/upload/auto-groups';
import { runInferenceForBatch } from '@/lib/upload/inference';
import type { UploadContext } from '@/lib/upload/resolver';
import type { NonMeteredPayload, PendingInvoice } from '@/lib/upload/types';

const BATCH_CHUNK_SIZE = 200;

// ---------------------------------------------------------------------------
// Metered invoice batch insert
// ---------------------------------------------------------------------------

/**
 * Insert metered invoices, deduplicating against existing DB records and
 * against other rows in the same upload batch.
 * Returns the count of rows actually inserted.
 */
export async function batchInsertInvoices(
  supabase: SupabaseClient,
  invoices: PendingInvoice[],
  errors: string[],
): Promise<number> {
  if (invoices.length === 0) return 0;

  const meterIds = Array.from(new Set(invoices.map((i) => i.meter_id)));
  const existingKeys = new Set<string>();

  for (let i = 0; i < meterIds.length; i += BATCH_CHUNK_SIZE) {
    const meterChunk = meterIds.slice(i, i + BATCH_CHUNK_SIZE);
    const { data: existing } = await supabase
      .from('actual_invoices')
      .select('meter_id, invoice_number, period_start_date, period_end_date, status')
      .in('meter_id', meterChunk)
      .limit(10000);

    for (const e of existing || []) {
      if (e.invoice_number) {
        existingKeys.add(`${e.meter_id}__inv__${e.invoice_number}`);
        existingKeys.add(`${e.meter_id}__${e.period_start_date}__${e.period_end_date}`);
      } else {
        const st = (e.status || '').toUpperCase();
        if (st !== 'DEACTIVATED') {
          existingKeys.add(`${e.meter_id}__${e.period_start_date}__${e.period_end_date}`);
        }
      }
    }
  }

  const seen = new Set<string>(existingKeys);
  const newInvoices: PendingInvoice[] = [];
  for (const inv of invoices) {
    if (inv.invoice_number) {
      const invKey = `${inv.meter_id}__inv__${inv.invoice_number}`;
      if (seen.has(invKey)) continue;
      const periodKey = `${inv.meter_id}__${inv.period_start_date}__${inv.period_end_date}`;
      if (seen.has(periodKey)) continue;
      seen.add(invKey);
      seen.add(periodKey);
      newInvoices.push(inv);
      continue;
    }
    const periodKey = `${inv.meter_id}__${inv.period_start_date}__${inv.period_end_date}`;
    if (seen.has(periodKey)) continue;
    seen.add(periodKey);
    newInvoices.push(inv);
  }

  if (newInvoices.length === 0) return 0;

  // Remove DEACTIVATED placeholders for the same meter+period as incoming real rows.
  const nonDeactivated = newInvoices.filter(
    (inv) => (inv.status || 'IMPORTED').toUpperCase() !== 'DEACTIVATED',
  );
  for (const inv of nonDeactivated) {
    await supabase
      .from('actual_invoices')
      .delete()
      .eq('meter_id', inv.meter_id)
      .eq('period_start_date', inv.period_start_date)
      .eq('period_end_date', inv.period_end_date)
      .eq('status', 'DEACTIVATED');
  }

  let count = 0;
  for (let i = 0; i < newInvoices.length; i += BATCH_CHUNK_SIZE) {
    const chunk = newInvoices.slice(i, i + BATCH_CHUNK_SIZE);
    const { data, error } = await supabase.from('actual_invoices').insert(chunk).select('id');
    if (error) {
      console.error('Batch invoice insert failed:', error);
      errors.push(`Batch invoice insert failed: ${error.message}`);
    } else {
      count += data?.length ?? 0;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Non-metered batch upsert helpers
// ---------------------------------------------------------------------------

function nonMeteredUpsertConflictKey(rec: NonMeteredPayload): string {
  return `${rec.facilityId}__${rec.supplierId ?? ''}__${rec.categoryId}__${rec.periodStart}__${rec.periodEnd}`;
}

function nonMeteredPayloadPriority(rec: NonMeteredPayload): number {
  const s = (rec.status || 'IMPORTED').toUpperCase();
  const order: Record<string, number> = {
    IMPORTED: 100, MANUAL: 95, CONFIRMED: 90, DEACTIVATED: 50,
    PENDING: 40, INFERRED_EMPTY: 30, ERROR: 10,
  };
  let p = order[s] ?? 20;
  if (rec.consumption != null || rec.amount != null) p += 5;
  if (rec.invoiceNumber?.trim()) p += 2;
  return p;
}

function dedupeNonMeteredForUpsert(records: NonMeteredPayload[]): NonMeteredPayload[] {
  const map = new Map<string, NonMeteredPayload>();
  for (const rec of records) {
    const key = nonMeteredUpsertConflictKey(rec);
    const prev = map.get(key);
    if (!prev || nonMeteredPayloadPriority(rec) > nonMeteredPayloadPriority(prev)) {
      map.set(key, rec);
    }
  }
  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Non-metered batch upsert
// ---------------------------------------------------------------------------

export async function processNonMeteredBatch(
  ctx: UploadContext,
  records: NonMeteredPayload[],
  errors: string[],
): Promise<number> {
  if (records.length === 0) return 0;

  const deduped = dedupeNonMeteredForUpsert(records);

  // Register non_metered_lines rows so facilities appear in the coverage grid
  // even before/after records are written.
  const linePayloads = deduped
    .filter((r) => r.supplierId !== null)
    .map((r) => ({
      facilityId: r.facilityId,
      supplierId: r.supplierId!,
      inputTypeId: r.categoryId,
      categoryId: r.reportingCategoryId ?? null,
    }));
  try {
    await upsertNonMeteredLines(ctx.supabase, linePayloads);
  } catch (e) {
    errors.push(
      `Non-metered line registration failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  let successCount = 0;
  const upsertedIds: Array<{
    id: string;
    facilityId: string;
    supplierId: string | null;
    categoryId: string;
    periodStart: string;
    periodEnd: string;
    status: string;
  }> = [];

  for (let i = 0; i < deduped.length; i += BATCH_CHUNK_SIZE) {
    const chunk = deduped.slice(i, i + BATCH_CHUNK_SIZE);
    const rows = chunk.map((rec) => ({
      facility_id: rec.facilityId,
      supplier_id: rec.supplierId,
      input_type_id: rec.categoryId,
      invoice_number: rec.invoiceNumber,
      invoice_date: rec.invoiceDate,
      period_start_date: rec.periodStart,
      period_end_date: rec.periodEnd,
      consumption: rec.consumption,
      unit: rec.unit,
      amount: rec.amount,
      sub_category: rec.subCategory,
      input_type: rec.inputType,
      framework: rec.framework,
      version: rec.version,
      customer: rec.customer,
      status: rec.status || 'IMPORTED',
      inferred_from_id: null,
    }));

    const { data, error } = await ctx.supabase
      .from('non_metered_records')
      .upsert(rows, {
        onConflict: 'facility_id,supplier_id,input_type_id,period_start_date,period_end_date',
      })
      .select('id, facility_id, supplier_id, input_type_id, period_start_date, period_end_date, status');

    if (error) {
      errors.push(`Batch non-metered upsert failed: ${error.message}`);
    } else if (data) {
      successCount += data.length;
      for (const row of data) {
        upsertedIds.push({
          id: row.id,
          facilityId: row.facility_id,
          supplierId: row.supplier_id,
          categoryId: row.input_type_id,
          periodStart: row.period_start_date,
          periodEnd: row.period_end_date,
          status: row.status as string,
        });
      }
    }
  }

  await autoCreateNonMeteredGroups(ctx, deduped, errors);

  const inferenceSeeds = upsertedIds.filter((r) =>
    ['IMPORTED', 'MANUAL', 'CONFIRMED'].includes(r.status || ''),
  );
  await runInferenceForBatch(ctx.supabase, inferenceSeeds, errors);

  return successCount;
}
