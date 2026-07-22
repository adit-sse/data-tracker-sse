/**
 * lib/upload/process-invoice-row.ts
 *
 * Processes a single row from an "invoice format" upload
 * (Company + Date Range columns present).
 *
 * Reuses parseMeterIdentifierFromNgersRow from lib/ingestion-metered.ts so
 * the NMI/MIRN/Account/Meter precedence logic lives in one place.
 */

import type { CSVRow } from '@/types';
import { parseDateRange } from '@/lib/coverage';
import { parseMeterIdentifierFromNgersRow } from '@/lib/ingestion-metered';
import {
  CLIENT_WIDE_FACILITY_NAME,
  isClientWideFacilityName,
} from '@/lib/client-wide-facility';
import {
  cachedFindOrCreateFacility,
  cachedFindOrCreateSupplier,
  cachedFindOrCreateCategory,
  cachedFindOrCreateMeter,
  mapUtilityToCategory,
  toSentenceCase,
  type UploadContext,
} from '@/lib/upload/resolver';
import type { NonMeteredPayload, PendingInvoice } from '@/lib/upload/types';

export type { NonMeteredPayload, PendingInvoice };

/**
 * Process one invoice-format row.
 *
 * - Metered rows: push a PendingInvoice onto pendingInvoices; return void.
 * - Non-metered rows: return { type: 'non_metered', payload }.
 * - Duplicate metered invoice (by invoice_number): return void silently.
 * - Validation error: throw.
 */
export async function processRow(
  ctx: UploadContext,
  row: CSVRow,
  rowNum: number,
  pendingInvoices: PendingInvoice[],
): Promise<{ type: 'non_metered'; payload: NonMeteredPayload } | void> {
  const missingFields: string[] = [];
  if (!row.Company?.trim()) missingFields.push('Company');
  if (!row.Category?.trim()) missingFields.push('Category');
  if (missingFields.length > 0) {
    throw new Error(`Missing required field(s): ${missingFields.join(', ')}`);
  }
  if (!row['Date Range']) throw new Error('Missing Date Range');

  const providerName = row.Provider?.trim() || null;

  const dateRange = parseDateRange(row['Date Range']);
  if (!dateRange) throw new Error(`Invalid date range format: ${row['Date Range']}`);

  const categoryName = toSentenceCase(mapUtilityToCategory(row.Category!));
  const { id: categoryId, is_metered, scope } = await cachedFindOrCreateCategory(ctx, categoryName);

  const rawFac = row.Facility?.trim() ?? '';
  let facilityName: string;
  if (!rawFac) {
    if (scope === 3) facilityName = CLIENT_WIDE_FACILITY_NAME;
    else throw new Error('Missing required field(s): Facility');
  } else if (isClientWideFacilityName(rawFac)) {
    facilityName = CLIENT_WIDE_FACILITY_NAME;
  } else {
    facilityName = rawFac;
  }

  const facilityId = await cachedFindOrCreateFacility(ctx, facilityName, row['Supply Address']?.trim() || null);
  const supplierId = providerName ? await cachedFindOrCreateSupplier(ctx, providerName) : null;

  if (is_metered === false) {
    return {
      type: 'non_metered',
      payload: {
        facilityId,
        supplierId,
        categoryId,
        reportingCategoryId: null,
        periodStart: dateRange.startDate,
        periodEnd: dateRange.endDate,
        status: 'CONFIRMED',
      },
    };
  }

  // Reuse shared meter-identifier logic from the ingestion pipeline.
  const identResult = parseMeterIdentifierFromNgersRow(row as Record<string, unknown>);
  if (!identResult.ok) {
    throw new Error(identResult.error);
  }

  const meterId = await cachedFindOrCreateMeter(ctx, {
    facilityId,
    supplierId,
    categoryId,
    reportingCategoryId: null,
    identifierType: identResult.identifier_type,
    lookup1: identResult.lookup1,
    lookup2: identResult.lookup2,
  });

  pendingInvoices.push({
    meter_id: meterId,
    period_start_date: dateRange.startDate,
    period_end_date: dateRange.endDate,
    status: 'CONFIRMED',
  });
}
