export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { parseDateRange } from '@/lib/coverage';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { CSVRow, MeterSetupRow, UploadResult, IdentifierType } from '@/types';

// -------------------------------------------------------
// Category classification — used ONLY at insert time.
// The routing logic reads is_metered from the DB; it never
// re-examines the category name.
// -------------------------------------------------------

const CATEGORY_RULES: Array<{
  keywords: string[];
  scope: number;
  is_metered: boolean;
}> = [
  { keywords: ['ELECTRICITY'], scope: 2, is_metered: true },
  // Word-boundary matching means GAS/GASOLINE order no longer matters,
  // but keep GASOLINE before GAS for clarity.
  { keywords: ['GASOLINE', 'PETROL'], scope: 1, is_metered: false },
  { keywords: ['GAS'], scope: 1, is_metered: true },
  {
    keywords: ['DIESEL', 'FUEL', 'LPG', 'OIL', 'GREASE'],
    scope: 1,
    is_metered: false,
  },
  {
    keywords: [
      'SCOPE 3',
      'PURCHASED',
      'CAPITAL GOODS',
      'UPSTREAM TRANSPORT',
      'DOWNSTREAM TRANSPORT',
      'BUSINESS TRAVEL',
      'WASTE',
    ],
    scope: 3,
    is_metered: false,
  },
];

// Word-boundary match: \bKEYWORD\b so "GAS" doesn't hit "GASOLINE" or "GARBAGE"
function keywordMatches(normalised: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword}\\b`).test(normalised);
}

function classifyCategory(name: string): {
  scope: number;
  is_metered: boolean;
  needs_review: boolean;
} {
  const normalised = name.trim().toUpperCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => keywordMatches(normalised, k))) {
      return { scope: rule.scope, is_metered: rule.is_metered, needs_review: false };
    }
  }
  // Unrecognised — safe default, flag for manual review
  return { scope: 1, is_metered: false, needs_review: true };
}

// -------------------------------------------------------
// Internal type for non-metered rows collected during the
// main loop and written in batch after all rows complete.
// -------------------------------------------------------
interface NonMeteredPayload {
  facilityId: string;
  supplierId: string | null;
  categoryId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  periodStart: string;
  periodEnd: string;
  consumption: number | null;
  unit: string | null;
  amount: number | null;
  subCategory: string | null;
  inputType: string | null;
  framework: string | null;
  version: string | null;
  customer: string | null;
}

// POST /api/clients/[id]/upload - Process CSV/XLSX upload
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    let rows: Record<string, string>[] = [];

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(worksheet, { raw: false });
    } else if (fileName.endsWith('.csv')) {
      const text = await file.text();
      const parseResult = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
      });

      if (parseResult.errors.length > 0) {
        return NextResponse.json(
          { error: 'Failed to parse CSV file', details: parseResult.errors },
          { status: 400 }
        );
      }

      rows = parseResult.data;
    } else {
      return NextResponse.json(
        { error: 'Invalid file format. Please upload a CSV or XLSX file.' },
        { status: 400 }
      );
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'File is empty or has no valid data rows' },
        { status: 400 }
      );
    }

    // Detect format based on column headers
    const firstRow = rows[0];
    const headers = Object.keys(firstRow);
    const isMeterSetupFormat = headers.some((h) => h === 'Utility' || h === 'MonthsWithData');

    const errors: string[] = [];
    let imported = 0;
    const nonMeteredBatch: NonMeteredPayload[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 for header row and 1-indexed

      try {
        if (isMeterSetupFormat) {
          const result = await processMeterSetupRow(params.id, row as unknown as MeterSetupRow, rowNum);
          if (result?.type === 'non_metered') {
            // Push all per-month payloads — do NOT increment imported yet
            nonMeteredBatch.push(...result.payloads);
          } else {
            imported++;
          }
        } else {
          const result = await processRow(params.id, row as unknown as CSVRow, rowNum);
          if (result?.type === 'non_metered') {
            nonMeteredBatch.push(result.payload);
            // Do NOT increment imported here — record not written yet
          } else {
            imported++;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Row ${rowNum}: ${message}`);
      }
    }

    // Process all non-metered rows as a batch (enables inference logic)
    if (nonMeteredBatch.length > 0) {
      const nonMeteredImported = await processNonMeteredBatch(params.id, nonMeteredBatch, errors);
      imported += nonMeteredImported;
    }

    const result: UploadResult = {
      success: imported > 0,
      imported,
      errors,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error processing upload:', error);
    return NextResponse.json({ error: 'Failed to process upload' }, { status: 500 });
  }
}

// -------------------------------------------------------
// processRow — detailed invoice format
// Returns a non-metered payload if the category is not
// metered, or void if inserted directly into actual_invoices.
// -------------------------------------------------------
async function processRow(
  clientId: string,
  row: CSVRow,
  rowNum: number
): Promise<{ type: 'non_metered'; payload: NonMeteredPayload } | void> {
  // 1. Validate required fields
  const missingFields: string[] = [];
  if (!row.Company?.trim()) missingFields.push('Company');
  if (!row.Facility?.trim()) missingFields.push('Facility');
  if (!row.Category?.trim()) missingFields.push('Category');

  if (missingFields.length > 0) {
    throw new Error(`Missing required field(s): ${missingFields.join(', ')}`);
  }

  if (!row['Date Range']) {
    throw new Error('Missing Date Range');
  }

  const providerName = row.Provider?.trim() || null;

  // 2. Parse date range
  const dateRange = parseDateRange(row['Date Range']);
  if (!dateRange) {
    throw new Error(`Invalid date range format: ${row['Date Range']}`);
  }

  // 3. Find or create facility
  const facilityName = row.Facility!.trim();
  const { data: facilityRows } = await supabase
    .from('facilities')
    .select('id')
    .eq('client_id', clientId)
    .ilike('name', facilityName)
    .limit(1);

  let facility: { id: string } | null = facilityRows?.[0] || null;

  if (!facility) {
    const { data: newFacility, error } = await supabase
      .from('facilities')
      .insert([{ client_id: clientId, name: facilityName, address: row['Supply Address']?.trim() || null }])
      .select('id')
      .single();
    if (error) throw new Error(`Failed to create facility: ${error.message}`);
    facility = newFacility;
  }

  // 4. Find or create supplier (optional)
  const supplierId = providerName ? await findOrCreateSupplier(providerName) : null;

  // 5. Find or create utility category (with classification on first insert)
  const categoryName = mapUtilityToCategory(row.Category!);
  const { id: categoryId, is_metered } = await findOrCreateCategory(categoryName);

  // 6. Route based on is_metered flag from DB — never keyword-match here
  if (is_metered === false) {
    return {
      type: 'non_metered',
      payload: {
        facilityId: facility.id,
        supplierId,
        categoryId,
        invoiceNumber: row['Invoice Number']?.trim() || null,
        invoiceDate: row['Invoice Date']?.trim() || null,
        periodStart: dateRange.startDate,
        periodEnd: dateRange.endDate,
        consumption: row.Consumption ? parseFloat(row.Consumption) : null,
        unit: row['Unit Type']?.trim() || null,
        amount: row['Amount($)'] ? parseFloat(row['Amount($)'].replace(/[^0-9.-]/g, '')) : null,
        subCategory: row['Sub-category']?.trim() || null,
        inputType: row['Input Type']?.trim() || null,
        framework: row.Framework?.trim() || null,
        version: row.Version?.trim() || null,
        customer: row.Customer?.trim() || null,
      },
    };
  }

  // 7. Metered path — require a meter identifier
  let identifierType: IdentifierType;
  let lookup1: string;
  let lookup2: string | null = null;

  if (row.NMI && row.NMI.trim()) {
    identifierType = 'NMI';
    lookup1 = row.NMI.trim();
    lookup2 = row['Input Type']?.trim() || null;
  } else if (row.MIRN && row.MIRN.trim()) {
    identifierType = 'MIRN';
    lookup1 = row.MIRN.trim();
    lookup2 = row['Input Type']?.trim() || null;
  } else if (row['Account Number'] && row['Account Number'].trim()) {
    identifierType = 'ACCOUNT_NUMBER';
    lookup1 = row['Account Number'].trim();
    lookup2 = row['Input Type']?.trim() || null;
  } else if (row['Meter Number'] && row['Meter Number'].trim()) {
    identifierType = 'METER_NUMBER';
    lookup1 = row['Meter Number'].trim();
  } else {
    throw new Error('No meter identifier found (NMI, MIRN, Account Number, or Meter Number)');
  }

  // 8. Find or create meter
  let { data: meter } = await supabase
    .from('meters')
    .select('id')
    .eq('facility_id', facility.id)
    .eq('utility_category_id', categoryId)
    .eq('identifier_type', identifierType)
    .eq('lookup1', lookup1)
    .single();

  if (!meter) {
    const { data: newMeter, error } = await supabase
      .from('meters')
      .insert([{
        facility_id: facility.id,
        supplier_id: supplierId,
        utility_category_id: categoryId,
        identifier_type: identifierType,
        lookup1,
        lookup2,
      }])
      .select('id')
      .single();

    if (error) throw new Error(`Failed to create meter: ${error.message}`);
    meter = newMeter;
  }

  // 9. Insert invoice (skip duplicates by invoice_number)
  if (row['Invoice Number'] && row['Invoice Number'].trim()) {
    const { data: existingInvoice } = await supabase
      .from('actual_invoices')
      .select('id')
      .eq('meter_id', meter.id)
      .eq('invoice_number', row['Invoice Number'].trim())
      .single();

    if (existingInvoice) return; // skip duplicate
  }

  const { error: invoiceError } = await supabase.from('actual_invoices').insert([{
    meter_id: meter.id,
    invoice_number: row['Invoice Number']?.trim() || null,
    invoice_date: row['Invoice Date'] || null,
    period_start_date: dateRange.startDate,
    period_end_date: dateRange.endDate,
    consumption: row.Consumption ? parseFloat(row.Consumption) : null,
    amount: row['Amount($)'] ? parseFloat(row['Amount($)'].replace(/[^0-9.-]/g, '')) : null,
    framework: row.Framework?.trim() || null,
    version: row.Version?.trim() || null,
    input_type: row['Input Type']?.trim() || null,
    emissions_factor: row['Output (tCO2-e)'] ? parseFloat(row['Output (tCO2-e)']) : null,
    customer: row.Customer?.trim() || null,
    status: 'IMPORTED',
  }]);

  if (invoiceError) {
    throw new Error(`Failed to create invoice: ${invoiceError.message}`);
  }
}

// -------------------------------------------------------
// processNonMeteredBatch
// Upserts all collected non-metered payloads, then runs
// inference for facility groups.
// Returns the count of successfully written records.
// -------------------------------------------------------
async function processNonMeteredBatch(
  clientId: string,
  records: NonMeteredPayload[],
  errors: string[]
): Promise<number> {
  if (records.length === 0) return 0;

  let successCount = 0;

  // Upsert each record — if an INFERRED_EMPTY exists for this unique key,
  // replace it with the real data. Use ON CONFLICT DO UPDATE.
  const upsertedIds: Array<{ id: string; facilityId: string; supplierId: string | null; categoryId: string; periodStart: string; periodEnd: string }> = [];

  for (const rec of records) {
    try {
      const { data, error } = await supabase
        .from('non_metered_records')
        .upsert(
          {
            facility_id: rec.facilityId,
            supplier_id: rec.supplierId,
            utility_category_id: rec.categoryId,
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
            status: 'IMPORTED',
            inferred_from_id: null,
          },
          {
            onConflict: 'facility_id,supplier_id,utility_category_id,period_start_date,period_end_date',
          }
        )
        .select('id')
        .single();

      if (error) {
        errors.push(`Non-metered record (facility ${rec.facilityId}, ${rec.periodStart}): ${error.message}`);
      } else if (data) {
        successCount++;
        upsertedIds.push({
          id: data.id,
          facilityId: rec.facilityId,
          supplierId: rec.supplierId,
          categoryId: rec.categoryId,
          periodStart: rec.periodStart,
          periodEnd: rec.periodEnd,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`Non-metered record (facility ${rec.facilityId}): ${msg}`);
    }
  }

  // Run inference: for each (supplier, category, period) group, find which
  // facility_group members were absent and insert INFERRED_EMPTY records.
  await runInferenceForBatch(upsertedIds, errors);

  return successCount;
}

// -------------------------------------------------------
// Inference logic
// -------------------------------------------------------
async function runInferenceForBatch(
  upsertedRecords: Array<{
    id: string;
    facilityId: string;
    supplierId: string | null;
    categoryId: string;
    periodStart: string;
    periodEnd: string;
  }>,
  errors: string[]
): Promise<void> {
  if (upsertedRecords.length === 0) return;

  // Group by (supplierId, categoryId, periodStart, periodEnd)
  const groups = new Map<
    string,
    { supplierId: string | null; categoryId: string; periodStart: string; periodEnd: string; facilityIds: Set<string>; referenceId: string }
  >();

  for (const rec of upsertedRecords) {
    const key = `${rec.supplierId}__${rec.categoryId}__${rec.periodStart}__${rec.periodEnd}`;
    if (!groups.has(key)) {
      groups.set(key, {
        supplierId: rec.supplierId,
        categoryId: rec.categoryId,
        periodStart: rec.periodStart,
        periodEnd: rec.periodEnd,
        facilityIds: new Set(),
        referenceId: rec.id,
      });
    }
    groups.get(key)!.facilityIds.add(rec.facilityId);
  }

  for (const group of Array.from(groups.values())) {
    if (!group.supplierId) continue; // can't infer without a supplier

    const presentFacilityIds = Array.from(group.facilityIds);

    // Find facility groups where all present facilities belong to the same group + supplier
    const { data: groupMembers, error: gmError } = await supabase
      .from('facility_group_members')
      .select('group_id, facility_id, facility_groups!inner(supplier_id)')
      .in('facility_id', presentFacilityIds)
      .eq('facility_groups.supplier_id', group.supplierId);

    if (gmError || !groupMembers?.length) continue;

    // Find which group_ids have at least one of the present facilities
    const groupIds = Array.from(new Set(groupMembers.map((m: any) => m.group_id)));

    for (const groupId of groupIds) {
      // Fetch all members of this group
      const { data: allMembers, error: allMembersError } = await supabase
        .from('facility_group_members')
        .select('facility_id')
        .eq('group_id', groupId);

      if (allMembersError || !allMembers?.length) continue;

      const absentFacilityIds = allMembers
        .map((m: any) => m.facility_id)
        .filter((fid: string) => !group.facilityIds.has(fid));

      for (const absentFacilityId of absentFacilityIds) {
        const { error: inferError } = await supabase
          .from('non_metered_records')
          .upsert(
            {
              facility_id: absentFacilityId,
              supplier_id: group.supplierId,
              utility_category_id: group.categoryId,
              period_start_date: group.periodStart,
              period_end_date: group.periodEnd,
              status: 'INFERRED_EMPTY',
              inferred_from_id: group.referenceId,
            },
            {
              onConflict: 'facility_id,supplier_id,utility_category_id,period_start_date,period_end_date',
              ignoreDuplicates: true, // never overwrite IMPORTED or MANUAL
            }
          );

        if (inferError) {
          errors.push(`Inference failed for facility ${absentFacilityId}: ${inferError.message}`);
        }
      }
    }
  }
}

// -------------------------------------------------------
// Parse month range like "Jul 2025 - Nov 2025"
// -------------------------------------------------------
function parseMonthRange(monthsWithData: string): { startDate: string; endDate: string } | null {
  if (!monthsWithData || !monthsWithData.trim()) return null;

  const parts = monthsWithData.split('-').map((p) => p.trim());
  if (parts.length !== 2) return null;

  const monthMap: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };

  const parseMonthYear = (str: string): { month: number; year: number } | null => {
    const match = str.match(/^(\w{3})\s+(\d{4})$/);
    if (!match) return null;
    const month = monthMap[match[1]];
    if (month === undefined) return null;
    return { month, year: parseInt(match[2]) };
  };

  const start = parseMonthYear(parts[0]);
  const end = parseMonthYear(parts[1]);
  if (!start || !end) return null;

  const startDate = `${start.year}-${String(start.month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(end.year, end.month + 1, 0).getDate();
  const endDate = `${end.year}-${String(end.month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  return { startDate, endDate };
}

// -------------------------------------------------------
// Generate monthly periods between two dates
// -------------------------------------------------------
function generateMonthlyPeriods(startDate: string, endDate: string): Array<{ start: string; end: string }> {
  const periods: Array<{ start: string; end: string }> = [];
  const end = new Date(endDate);
  let current = new Date(startDate);
  current = new Date(current.getFullYear(), current.getMonth(), 1);

  while (current <= end) {
    const monthStart = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
    const monthEnd = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    periods.push({ start: monthStart, end: monthEnd });
    current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  }

  return periods;
}

// -------------------------------------------------------
// Helper: find or create supplier (case-insensitive upsert)
// -------------------------------------------------------
async function findOrCreateSupplier(name: string): Promise<string> {
  const { data: existing } = await supabase
    .from('suppliers')
    .select('id')
    .ilike('name', name)
    .limit(1);

  if (existing && existing.length > 0) return existing[0].id;

  const { data: created, error } = await supabase
    .from('suppliers')
    .insert([{ name }])
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate')) {
      const { data: retry } = await supabase
        .from('suppliers')
        .select('id')
        .ilike('name', name)
        .limit(1);
      if (retry && retry.length > 0) return retry[0].id;
    }
    throw new Error(`Failed to create supplier: ${error.message}`);
  }

  return created.id;
}

// -------------------------------------------------------
// Helper: find or create utility category.
// classifyCategory() is also re-run on existing rows so that
// previously mis-classified categories (e.g. from a stale rule)
// are automatically corrected whenever they are encountered.
// -------------------------------------------------------
async function findOrCreateCategory(name: string): Promise<{ id: string; is_metered: boolean }> {
  const { data: existing } = await supabase
    .from('utility_categories')
    .select('id, is_metered, scope, needs_review')
    .ilike('name', name)
    .limit(1);

  if (existing && existing.length > 0) {
    const row = existing[0];
    const classification = classifyCategory(name);

    // If our confident classification disagrees with the stored values, auto-correct.
    const needsCorrection =
      !classification.needs_review &&
      (row.is_metered !== classification.is_metered || row.scope !== classification.scope);

    if (needsCorrection) {
      await supabase
        .from('utility_categories')
        .update({
          scope: classification.scope,
          is_metered: classification.is_metered,
          needs_review: false,
        })
        .eq('id', row.id);
      return { id: row.id, is_metered: classification.is_metered };
    }

    return { id: row.id, is_metered: row.is_metered ?? true };
  }

  const classification = classifyCategory(name);

  const { data: created, error } = await supabase
    .from('utility_categories')
    .insert([{
      name,
      scope: classification.scope,
      is_metered: classification.is_metered,
      needs_review: classification.needs_review,
    }])
    .select('id, is_metered')
    .single();

  if (error) {
    if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate')) {
      const { data: retry } = await supabase
        .from('utility_categories')
        .select('id, is_metered')
        .ilike('name', name)
        .limit(1);
      if (retry && retry.length > 0) {
        return { id: retry[0].id, is_metered: retry[0].is_metered ?? true };
      }
    }
    throw new Error(`Failed to create utility category: ${error.message}`);
  }

  return { id: created.id, is_metered: created.is_metered ?? true };
}

// Infer identifier type from utility name when an identifier is present in a
// meter setup row. Word-boundary matching prevents GAS matching GASOLINE.
function inferIdentifierType(utilityName: string): IdentifierType {
  const normalised = utilityName.trim().toUpperCase();
  if (keywordMatches(normalised, 'ELECTRICITY')) return 'NMI';
  if (keywordMatches(normalised, 'GAS')) return 'METER_NUMBER';
  return 'ACCOUNT_NUMBER';
}

// Normalize only the 4 base category names for canonical casing
function mapUtilityToCategory(utility: string): string {
  const trimmed = utility.trim();
  const upper = trimmed.toUpperCase();
  if (upper === 'ELECTRICITY') return 'ELECTRICITY';
  if (upper === 'GAS') return 'GAS';
  if (upper === 'FUEL') return 'FUEL';
  if (upper === 'OIL') return 'OIL';
  return trimmed;
}

// -------------------------------------------------------
// Process meter setup format row
// -------------------------------------------------------
async function processMeterSetupRow(
  clientId: string,
  row: MeterSetupRow,
  rowNum: number
): Promise<{ type: 'non_metered'; payloads: NonMeteredPayload[] } | void> {
  if (!row.Facility?.trim()) throw new Error('Missing Facility name');
  if (!row.Utility?.trim()) throw new Error('Missing Utility type');

  const facilityName = row.Facility.trim();
  const utilityName = row.Utility.trim();
  const supplierName = row.Supplier?.trim() || null;
  const address = row.Address?.trim() || null;

  let dateRange: { startDate: string; endDate: string } | null = null;
  if (row.MonthsWithData?.trim()) {
    dateRange = parseMonthRange(row.MonthsWithData);
    if (!dateRange) throw new Error(`Invalid MonthsWithData format: ${row.MonthsWithData}`);
  }

  // Find or create facility
  const { data: facilityRows } = await supabase
    .from('facilities')
    .select('id')
    .eq('client_id', clientId)
    .ilike('name', facilityName)
    .limit(1);

  let facility: { id: string } | null = facilityRows?.[0] || null;

  if (!facility) {
    const { data: newFacility, error } = await supabase
      .from('facilities')
      .insert([{ client_id: clientId, name: facilityName, address }])
      .select('id')
      .single();
    if (error) throw new Error(`Failed to create facility: ${error.message}`);
    facility = newFacility;
  } else if (address) {
    await supabase.from('facilities').update({ address }).eq('id', facility.id).is('address', null);
  }

  const supplierId: string | null = supplierName ? await findOrCreateSupplier(supplierName) : null;

  const categoryName = mapUtilityToCategory(utilityName);
  const { id: categoryId, is_metered } = await findOrCreateCategory(categoryName);

  // Route based on is_metered flag — same two-stage logic as processRow()
  if (is_metered === false) {
    if (!dateRange) {
      // No date range provided — nothing to insert for non-metered (and no meter to create)
      return;
    }
    // Generate one payload per calendar month, matching how the metered path
    // creates one actual_invoice per month. This keeps period granularity consistent
    // and ensures inference logic can match on (supplier, category, period).
    const periods = generateMonthlyPeriods(dateRange.startDate, dateRange.endDate);
    const payloads: NonMeteredPayload[] = periods.map((period) => ({
      facilityId: facility!.id,
      supplierId,
      categoryId,
      periodStart: period.start,
      periodEnd: period.end,
      invoiceNumber: null,
      invoiceDate: null,
      consumption: null,
      unit: null,
      amount: null,
      subCategory: null,
      inputType: null,
      framework: null,
      version: null,
      customer: null,
    }));
    return { type: 'non_metered', payloads };
  }

  // Resolve identifier type and lookup1.
  // If the row has an Identifier value, infer the type from the utility name.
  // Otherwise fall back to DESCRIPTION with the compound facility+utility label.
  const identifierRaw = row.Identifier?.trim() || null;
  let identifierType: IdentifierType;
  let lookup1: string;

  if (identifierRaw) {
    identifierType = inferIdentifierType(utilityName);
    lookup1 = identifierRaw;
  } else {
    identifierType = 'DESCRIPTION';
    lookup1 = `${facilityName} ${utilityName}`;
  }

  let { data: meter } = await supabase
    .from('meters')
    .select('id')
    .eq('facility_id', facility!.id)
    .eq('utility_category_id', categoryId)
    .eq('identifier_type', identifierType)
    .eq('lookup1', lookup1)
    .maybeSingle();

  if (!meter) {
    const { data: newMeter, error } = await supabase
      .from('meters')
      .insert([{
        facility_id: facility!.id,
        supplier_id: supplierId,
        utility_category_id: categoryId,
        identifier_type: identifierType,
        lookup1,
        lookup2: supplierName,
      }])
      .select('id')
      .single();

    if (error) throw new Error(`Failed to create meter: ${error.message}`);
    meter = newMeter;
  }

  if (dateRange) {
    const periods = generateMonthlyPeriods(dateRange.startDate, dateRange.endDate);
    for (const period of periods) {
      const { data: existingInvoice } = await supabase
        .from('actual_invoices')
        .select('id')
        .eq('meter_id', meter.id)
        .eq('period_start_date', period.start)
        .eq('period_end_date', period.end)
        .single();

      if (!existingInvoice) {
        const { error: invoiceError } = await supabase.from('actual_invoices').insert([{
          meter_id: meter.id,
          period_start_date: period.start,
          period_end_date: period.end,
          status: 'IMPORTED',
        }]);

        if (invoiceError) {
          console.error(`Failed to create invoice for period ${period.start} - ${period.end}:`, invoiceError);
        }
      }
    }
  }
}
