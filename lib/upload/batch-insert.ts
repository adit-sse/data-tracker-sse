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
import { upsertNonMeteredLines, resolveNonMeteredLineIdMap, nonMeteredLineKey } from '@/lib/non-metered-lines';
import { autoCreateNonMeteredGroups } from '@/lib/upload/auto-groups';
import { runInferenceForBatch } from '@/lib/upload/inference';
import type { UploadContext } from '@/lib/upload/resolver';
import type { NonMeteredPayload, PendingInvoice } from '@/lib/upload/types';
import { upsertPendingMonthSlots, upsertDeactivatedMonthSlot } from '@/lib/meter-month-slots';

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
  // Track DEACTIVATED row IDs keyed by meter+period so we can batch-delete them later
  // without a second round-trip (we get the IDs from the deduplication fetch below).
  const deactivatedIdByPeriodKey = new Map<string, string>();

  const chunks: string[][] = [];
  for (let i = 0; i < meterIds.length; i += BATCH_CHUNK_SIZE) {
    chunks.push(meterIds.slice(i, i + BATCH_CHUNK_SIZE));
  }
  const fetchResults = await Promise.all(
    chunks.map((meterChunk) =>
      supabase
        .from('actual_invoices')
        .select('id, meter_id, period_start_date, period_end_date, status')
        .in('meter_id', meterChunk)
        .limit(10000)
    )
  );

  for (const { data: existing } of fetchResults) {
    for (const e of existing || []) {
      const st = (e.status || '').toUpperCase();
      if (st === 'DEACTIVATED') {
        deactivatedIdByPeriodKey.set(
          `${e.meter_id}__${e.period_start_date}__${e.period_end_date}`,
          e.id as string,
        );
      } else {
        existingKeys.add(`${e.meter_id}__${e.period_start_date}__${e.period_end_date}`);
      }
    }
  }

  const seen = new Set<string>(existingKeys);
  const newInvoices: PendingInvoice[] = [];
  for (const inv of invoices) {
    const periodKey = `${inv.meter_id}__${inv.period_start_date}__${inv.period_end_date}`;
    if (seen.has(periodKey)) continue;
    seen.add(periodKey);
    newInvoices.push(inv);
  }

  if (newInvoices.length === 0) return 0;

  // Remove DEACTIVATED placeholders for the same meter+period as incoming real rows.
  // IDs were collected during the deduplication fetch above — no extra round-trip needed.
  const nonDeactivated = newInvoices.filter(
    (inv) => (inv.status || 'CONFIRMED').toUpperCase() !== 'DEACTIVATED',
  );
  const deactivatedIdsToDelete = nonDeactivated
    .map((inv) =>
      deactivatedIdByPeriodKey.get(
        `${inv.meter_id}__${inv.period_start_date}__${inv.period_end_date}`,
      )
    )
    .filter((id): id is string => id !== undefined);

  if (deactivatedIdsToDelete.length > 0) {
    await supabase.from('actual_invoices').delete().in('id', deactivatedIdsToDelete);
  }

  const insertChunks: PendingInvoice[][] = [];
  for (let i = 0; i < newInvoices.length; i += BATCH_CHUNK_SIZE) {
    insertChunks.push(newInvoices.slice(i, i + BATCH_CHUNK_SIZE));
  }
  const insertResults = await Promise.all(
    insertChunks.map((chunk) =>
      supabase.from('actual_invoices').insert(chunk).select('id')
    )
  );
  let count = 0;
  for (const { data, error } of insertResults) {
    if (error) {
      console.error('Batch invoice insert failed:', error);
      errors.push(`Batch invoice insert failed: ${error.message}`);
    } else {
      count += data?.length ?? 0;
    }
  }

  // Upsert month slots for every inserted row.
  // DEACTIVATED segments → DEACTIVATED slot (meter off this month).
  // CONFIRMED segments → PENDING slot (creates if absent; never downgrades ERROR/DEACTIVATED).
  await Promise.all(
    newInvoices.map((inv) => {
      const status = (inv.status || 'CONFIRMED').toUpperCase();
      if (status === 'DEACTIVATED') {
        return upsertDeactivatedMonthSlot(supabase, inv.meter_id, inv.period_start_date, inv.period_end_date);
      }
      return upsertPendingMonthSlots(supabase, inv.meter_id, inv.period_start_date, inv.period_end_date);
    })
  );

  return count;
}

// ---------------------------------------------------------------------------
// Non-metered batch upsert helpers
// ---------------------------------------------------------------------------

function nonMeteredUpsertConflictKey(rec: NonMeteredPayload): string {
  return `${rec.facilityId}__${rec.supplierId ?? ''}__${rec.categoryId}__${rec.periodStart}__${rec.periodEnd}`;
}

function nonMeteredPayloadPriority(rec: NonMeteredPayload): number {
  const s = (rec.status || 'CONFIRMED').toUpperCase();
  const order: Record<string, number> = {
    CONFIRMED: 90, DEACTIVATED: 50, PENDING: 40, INFERRED_EMPTY: 30, ERROR: 10,
  };
  return order[s] ?? 20;
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

  const lineIdByKey =
    linePayloads.length > 0
      ? await resolveNonMeteredLineIdMap(ctx.supabase, linePayloads)
      : new Map<string, string>();

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
    const rows = chunk
      .map((rec) => {
        if (rec.supplierId === null) {
          errors.push(
            `Skipping non-metered record without supplier for facility ${rec.facilityId}`,
          );
          return null;
        }
        const lineKey = nonMeteredLineKey(rec.facilityId, rec.supplierId, rec.categoryId);
        const lineId = lineIdByKey.get(lineKey);
        if (!lineId) {
          errors.push(`Non-metered line not found for ${lineKey}`);
          return null;
        }
        return {
          non_metered_line_id: lineId,
          facility_id: rec.facilityId,
          supplier_id: rec.supplierId,
          input_type_id: rec.categoryId,
          period_start_date: rec.periodStart,
          period_end_date: rec.periodEnd,
          status: rec.status || 'CONFIRMED',
          inferred_from_id: null,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (rows.length === 0) continue;

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
    r.status === 'CONFIRMED',
  );
  await runInferenceForBatch(ctx.supabase, inferenceSeeds, errors);

  return successCount;
}
