/**
 * lib/upload/process-meter-setup-row.ts
 *
 * Processes a single row from a "meter-setup format" upload
 * (Utility / MonthsWithData / Input Type columns present).
 */

import type { MeterSetupRow } from '@/types';
import {
  CLIENT_WIDE_FACILITY_NAME,
  isClientWideFacilityName,
} from '@/lib/client-wide-facility';
import { upsertTemplateScope3CoverageMonths } from '@/lib/non-metered-pending-seed';
import { upsertNonMeteredLine } from '@/lib/non-metered-lines';
import {
  cachedFindOrCreateFacility,
  cachedFindOrCreateSupplier,
  cachedFindOrCreateCategory,
  cachedResolveReportingCategory,
  cachedFindOrCreateMeter,
  mapUtilityToCategory,
  toSentenceCase,
  inferIdentifierType,
  type UploadContext,
} from '@/lib/upload/resolver';
import { parseMonthRanges, generateMonthlyPeriods } from '@/lib/upload/month-ranges';
import type { NonMeteredPayload, PendingInvoice } from '@/lib/upload/types';

/** Read a BOM-tolerant column value from a row by logical name. */
function getColumn(row: Record<string, string | undefined>, colName: string): string {
  const direct = row[colName]?.trim();
  if (direct) return direct;
  const lower = colName.toLowerCase();
  for (const [k, v] of Object.entries(row)) {
    if (k.replace(/^\uFEFF/, '').trim().toLowerCase() === lower && v?.trim()) {
      return v.trim();
    }
  }
  return '';
}

export type MeterSetupResult =
  | { type: 'non_metered'; payloads: NonMeteredPayload[] }
  | { type: 'pending_seeded'; created: number }
  | { type: 'meter_setup'; created: number }
  | void;

export async function processMeterSetupRow(
  ctx: UploadContext,
  row: MeterSetupRow,
  rowNum: number,
  pendingInvoices: PendingInvoice[],
): Promise<MeterSetupResult> {
  const rowRec = row as Record<string, string | undefined>;
  const rawFacility = row.Facility?.trim() ?? '';

  const inputTypeCell = getColumn(rowRec, 'Input Type');

  let legacyUtility = row.Utility?.trim() ?? '';
  if (!legacyUtility && isClientWideFacilityName(rawFacility)) {
    legacyUtility = 'Scope 3';
  }

  let inputTypeName = inputTypeCell;
  if (!inputTypeName) {
    if (legacyUtility) inputTypeName = mapUtilityToCategory(legacyUtility);
    else throw new Error('Missing Input Type (or legacy Utility column)');
  }
  inputTypeName = toSentenceCase(inputTypeName);

  const reportingCategoryCell = getColumn(rowRec, 'Category');

  const { id: inputTypeId, is_metered, scope } = await cachedFindOrCreateCategory(ctx, inputTypeName);
  const reportingCategoryId = await cachedResolveReportingCategory(
    ctx,
    reportingCategoryCell || undefined,
    scope,
  );

  const supplierName = row.Supplier?.trim() || null;
  const address = row.Address?.trim() || null;

  let facilityName: string;
  if (!rawFacility) {
    if (scope === 3) facilityName = CLIENT_WIDE_FACILITY_NAME;
    else throw new Error('Missing Facility name');
  } else if (isClientWideFacilityName(rawFacility)) {
    facilityName = CLIENT_WIDE_FACILITY_NAME;
  } else {
    facilityName = rawFacility;
  }

  const monthsWithData = getColumn(rowRec, 'MonthsWithData');
  const monthsDeactivated = getColumn(rowRec, 'MonthsDeactivated');

  let dataRanges: Array<{ startDate: string; endDate: string }> | null = null;
  if (monthsWithData) {
    dataRanges = parseMonthRanges(monthsWithData);
    if (!dataRanges) throw new Error(`Invalid MonthsWithData format: ${monthsWithData}`);
  }

  let deactivatedRanges: Array<{ startDate: string; endDate: string }> | null = null;
  if (monthsDeactivated) {
    deactivatedRanges = parseMonthRanges(monthsDeactivated);
    if (!deactivatedRanges) throw new Error(`Invalid MonthsDeactivated format: ${monthsDeactivated}`);
  }

  const facilityId = await cachedFindOrCreateFacility(ctx, facilityName, address);
  const supplierId: string | null = supplierName
    ? await cachedFindOrCreateSupplier(ctx, supplierName)
    : null;

  // Scope 3 non-metered: seed PENDING months for current FY.
  if (scope === 3 && is_metered === false) {
    if (!supplierId) throw new Error('Missing Supplier for Scope 3 row');
    const created = await upsertTemplateScope3CoverageMonths(ctx.supabase, {
      facilityId,
      supplierId,
      inputTypeId,
    });
    return { type: 'pending_seeded', created };
  }

  const dataPeriods = dataRanges
    ? dataRanges.flatMap((r) => generateMonthlyPeriods(r.startDate, r.endDate))
    : [];
  const deactivatedPeriods = deactivatedRanges
    ? deactivatedRanges.flatMap((r) => generateMonthlyPeriods(r.startDate, r.endDate))
    : [];
  const dataMonthStarts = new Set(dataPeriods.map((p) => p.start));

  if (is_metered === false) {
    if (dataPeriods.length === 0 && deactivatedPeriods.length === 0) {
      // No period data — register line so it appears in the grid with no-data state.
      if (supplierId) {
        await upsertNonMeteredLine(ctx.supabase, {
          facilityId,
          supplierId,
          inputTypeId,
          categoryId: reportingCategoryId,
        });
      }
      return { type: 'meter_setup', created: 1 };
    }
    if (!supplierId) throw new Error('Missing Supplier (required for non-metered Fuel/LPG/etc.)');

    const base = {
      facilityId,
      supplierId,
      categoryId: inputTypeId,
      reportingCategoryId: reportingCategoryId ?? null,
      invoiceNumber: null as string | null,
      invoiceDate: null as string | null,
      consumption: null as number | null,
      unit: null as string | null,
      amount: null as number | null,
      subCategory: null as string | null,
      inputType: null as string | null,
      framework: null as string | null,
      version: null as string | null,
      customer: null as string | null,
    };

    const payloads: NonMeteredPayload[] = [
      ...dataPeriods.map((period) => ({ ...base, periodStart: period.start, periodEnd: period.end, status: 'IMPORTED' })),
      ...deactivatedPeriods
        .filter((period) => !dataMonthStarts.has(period.start))
        .map((period) => ({ ...base, periodStart: period.start, periodEnd: period.end, status: 'DEACTIVATED' })),
    ];
    return { type: 'non_metered', payloads };
  }

  // Metered row — resolve or create the meter.
  const identifierRaw = row.Identifier?.trim() || null;
  let lookup1: string;
  let identifierType = inferIdentifierType(inputTypeName);

  if (identifierRaw) {
    lookup1 = identifierRaw;
  } else {
    identifierType = 'DESCRIPTION';
    lookup1 = `${facilityName} ${inputTypeName}`;
  }

  const meterId = await cachedFindOrCreateMeter(ctx, {
    facilityId,
    supplierId,
    categoryId: inputTypeId,
    reportingCategoryId,
    identifierType,
    lookup1,
    lookup2: supplierName,
  });

  if (dataPeriods.length === 0 && deactivatedPeriods.length === 0) {
    return { type: 'meter_setup', created: 1 };
  }

  for (const period of dataPeriods) {
    pendingInvoices.push({
      meter_id: meterId,
      invoice_number: null,
      invoice_date: null,
      period_start_date: period.start,
      period_end_date: period.end,
      consumption: null,
      amount: null,
      framework: null,
      version: null,
      input_type: null,
      emissions_factor: null,
      customer: null,
      status: 'IMPORTED',
    });
  }
  for (const period of deactivatedPeriods) {
    if (dataMonthStarts.has(period.start)) continue;
    pendingInvoices.push({
      meter_id: meterId,
      invoice_number: null,
      invoice_date: null,
      period_start_date: period.start,
      period_end_date: period.end,
      consumption: null,
      amount: null,
      framework: null,
      version: null,
      input_type: null,
      emissions_factor: null,
      customer: null,
      status: 'DEACTIVATED',
    });
  }
}
