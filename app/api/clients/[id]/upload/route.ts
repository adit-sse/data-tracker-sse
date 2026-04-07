export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { parseDateRange } from '@/lib/coverage';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { CSVRow, MeterSetupRow, UploadResult, IdentifierType } from '@/types';
import {
  CLIENT_WIDE_FACILITY_NAME,
  isClientWideFacilityName,
} from '@/lib/client-wide-facility';
import { classifyCategory, keywordMatches } from '@/lib/utility-category-classification';
import { upsertTemplateScope3CoverageMonths } from '@/lib/non-metered-pending-seed';
import { upsertNonMeteredLine, upsertNonMeteredLines } from '@/lib/non-metered-lines';

const BATCH_CHUNK_SIZE = 200;

const UPLOAD_DEBUG = process.env.UPLOAD_DEBUG === '1';

function uploadLog(...args: unknown[]) {
  if (!UPLOAD_DEBUG) return;
  console.log('[upload]', ...args);
}

/** Row supplies MonthsDeactivated — do not carry forward MonthsWithData from above (avoids fuel inheriting electricity). */
function rowHasOwnMonthsDeactivated(r: Record<string, string>): boolean {
  if (r.MonthsDeactivated?.trim()) return true;
  for (const [k, v] of Object.entries(r)) {
    if (k.replace(/^\uFEFF/, '').trim().toLowerCase() === 'monthsdeactivated' && String(v ?? '').trim()) {
      return true;
    }
  }
  return false;
}

/** Trim keys/values; strip BOM from headers so row.MonthsWithData matches after XLSX parse. */
function normalizeSpreadsheetRow(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = String(k).replace(/^\uFEFF/, '').trim();
    if (!key) continue;
    if (v === undefined || v === null) continue;
    const s = typeof v === 'string' ? v : String(v);
    out[key] = s.replace(/^\uFEFF/, '').trim();
  }
  return out;
}

// -------------------------------------------------------
// Request-scoped caches to avoid redundant DB round-trips
// -------------------------------------------------------
interface UploadContext {
  supabase: SupabaseClient;
  clientId: string;
  facilityCache: Map<string, string>;
  supplierCache: Map<string, string>;
  categoryCache: Map<string, { id: string; is_metered: boolean; scope: number }>;
  meterCache: Map<string, string>;
}

function rememberMeter(
  ctx: UploadContext,
  facilityId: string,
  categoryId: string,
  lookup1: string,
  meterId: string,
  ...identifierTypes: IdentifierType[]
) {
  const types = new Set(identifierTypes);
  Array.from(types).forEach((t) => {
    ctx.meterCache.set(`${facilityId}__${categoryId}__${t}__${lookup1}`, meterId);
  });
  ctx.meterCache.set(`${facilityId}__${categoryId}__*__${lookup1}`, meterId);
}

async function initContext(supabase: SupabaseClient, clientId: string): Promise<UploadContext> {
  const ctx: UploadContext = {
    supabase,
    clientId,
    facilityCache: new Map(),
    supplierCache: new Map(),
    categoryCache: new Map(),
    meterCache: new Map(),
  };

  const [facilitiesRes, suppliersRes, categoriesRes] = await Promise.all([
    ctx.supabase.from('facilities').select('id, name, address').eq('client_id', clientId),
    ctx.supabase.from('suppliers').select('id, name'),
    ctx.supabase.from('utility_categories').select('id, name, is_metered, scope, needs_review'),
  ]);

  // Preload facilities by name+address only when that pair is unique in the DB.
  // Same facility name with different addresses (or duplicate name+empty address rows)
  // must not overwrite each other in the cache — those resolve per upload via DB.
  const facilityRows = facilitiesRes.data || [];
  const facilityKeyCounts = new Map<string, number>();
  for (const f of facilityRows) {
    const k = `${f.name.trim().toLowerCase()}__${(f.address || '').trim().toLowerCase()}`;
    facilityKeyCounts.set(k, (facilityKeyCounts.get(k) || 0) + 1);
  }
  for (const f of facilityRows) {
    const k = `${f.name.trim().toLowerCase()}__${(f.address || '').trim().toLowerCase()}`;
    if (facilityKeyCounts.get(k) === 1) {
      ctx.facilityCache.set(k, f.id);
    }
  }
  for (const s of suppliersRes.data || []) {
    ctx.supplierCache.set(s.name.trim().toLowerCase(), s.id);
  }
  for (const c of categoriesRes.data || []) {
    ctx.categoryCache.set(c.name.trim().toLowerCase(), {
      id: c.id,
      is_metered: c.is_metered ?? true,
      scope: typeof c.scope === 'number' ? c.scope : 2,
    });
  }

  const facilityIds = (facilitiesRes.data || []).map((f: any) => f.id);
  if (facilityIds.length > 0) {
    const { data: meters } = await ctx.supabase
      .from('meters')
      .select('id, facility_id, utility_category_id, identifier_type, lookup1')
      .in('facility_id', facilityIds);
    for (const m of meters || []) {
      rememberMeter(
        ctx,
        m.facility_id,
        m.utility_category_id,
        m.lookup1,
        m.id,
        m.identifier_type as IdentifierType,
      );
    }
  }

  return ctx;
}

// -------------------------------------------------------
// Internal types
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
  status: string;
}

interface PendingInvoice {
  meter_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  period_start_date: string;
  period_end_date: string;
  consumption: number | null;
  amount: number | null;
  framework: string | null;
  version: string | null;
  input_type: string | null;
  emissions_factor: number | null;
  customer: string | null;
  status: string;
}

// POST /api/clients/[id]/upload - Process CSV/XLSX upload
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
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
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { raw: false }) as Record<
        string,
        unknown
      >[];
      rows = rawRows.map((r) => normalizeSpreadsheetRow(r));
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

      rows = parseResult.data.map((r) => normalizeSpreadsheetRow(r as Record<string, unknown>));
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

    const ctx = await initContext(supabase, params.id);

    const firstRow = rows[0];
    const headers = Object.keys(firstRow);
    const isMeterSetupFormat = headers.some((h) => h === 'Utility' || h === 'MonthsWithData');

    // Excel merged cells often leave MonthsWithData blank on rows 2+; carry down like a spreadsheet.
    if (isMeterSetupFormat) {
      let lastMonths = '';
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        let m = r.MonthsWithData?.trim() ?? '';
        if (!m) {
          for (const [k, v] of Object.entries(r)) {
            if (k.replace(/^\uFEFF/, '').trim().toLowerCase() === 'monthswithdata') {
              m = String(v ?? '').trim();
              break;
            }
          }
        }
        if (m) lastMonths = m;
        else if (lastMonths && !rowHasOwnMonthsDeactivated(r)) m = lastMonths;
        if (m) rows[i] = { ...r, MonthsWithData: m };

        // Do not carry MonthsDeactivated down — it attaches fuel "off" ranges to LPG/electricity rows below.
        let md = r.MonthsDeactivated?.trim() ?? '';
        if (!md) {
          for (const [k, v] of Object.entries(rows[i])) {
            if (k.replace(/^\uFEFF/, '').trim().toLowerCase() === 'monthsdeactivated') {
              md = String(v ?? '').trim();
              break;
            }
          }
        }
        if (md) rows[i] = { ...rows[i], MonthsDeactivated: md };
      }
    }

    uploadLog('file=', fileName, 'rowCount=', rows.length, 'headers=', headers);
    if (UPLOAD_DEBUG && rows[0]) {
      uploadLog('firstRow sample=', {
        Facility: rows[0].Facility,
        Utility: rows[0].Utility,
        MonthsWithData: rows[0].MonthsWithData,
        Identifier: rows[0].Identifier,
      });
      if (rows[1]) {
        uploadLog('secondRow sample=', {
          Facility: rows[1].Facility,
          MonthsWithData: rows[1].MonthsWithData,
        });
      }
    }

    const errors: string[] = [];
    let imported = 0;
    let metersSetup = 0;
    const nonMeteredBatch: NonMeteredPayload[] = [];
    const pendingInvoices: PendingInvoice[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      try {
        if (isMeterSetupFormat) {
          const result = await processMeterSetupRow(ctx, row as unknown as MeterSetupRow, rowNum, pendingInvoices);
          if (result?.type === 'non_metered') {
            nonMeteredBatch.push(...result.payloads);
          } else if (result?.type === 'pending_seeded') {
            imported += result.created;
          } else if (result?.type === 'meter_setup') {
            metersSetup += result.created;
          }
          // metered rows with data periods are counted when their invoices are batch-inserted below
        } else {
          const result = await processRow(ctx, row as unknown as CSVRow, rowNum, pendingInvoices);
          if (result?.type === 'non_metered') {
            nonMeteredBatch.push(result.payload);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Row ${rowNum}: ${message}`);
      }
    }

    // Batch-insert all collected metered invoices (with dedup)
    if (pendingInvoices.length > 0) {
      const invoiceCount = await batchInsertInvoices(supabase, pendingInvoices, errors);
      imported += invoiceCount;
      uploadLog(
        'pendingInvoices=',
        pendingInvoices.length,
        'inserted=',
        invoiceCount,
        '(rest deduped or failed — enable UPLOAD_DEBUG for batchInsertInvoices details)',
      );
    } else if (isMeterSetupFormat) {
      uploadLog('meter setup: pendingInvoices=0 (no period rows queued — check MonthsWithData / merge cells)');
    }

    // Batch-upsert all non-metered records + inference
    if (nonMeteredBatch.length > 0) {
      const nonMeteredImported = await processNonMeteredBatch(ctx, nonMeteredBatch, errors);
      imported += nonMeteredImported;
    }

    console.info(
      '[upload] client=%s file=%s meterSetup=%s rows=%s pendingInvoices=%s imported=%s metersSetup=%s errors=%s',
      params.id,
      fileName,
      isMeterSetupFormat,
      rows.length,
      pendingInvoices.length,
      imported,
      metersSetup,
      errors.length,
    );

    const result: UploadResult = {
      success: imported > 0 || metersSetup > 0,
      imported,
      metersSetup: metersSetup > 0 ? metersSetup : undefined,
      errors,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error processing upload:', error);
    return NextResponse.json({ error: 'Failed to process upload' }, { status: 500 });
  }
}

// -------------------------------------------------------
// Batch-insert metered invoices with dedup against existing DB records.
// Fetches existing invoices for the involved meters in one query,
// filters out duplicates, then inserts only new records.
// -------------------------------------------------------
async function batchInsertInvoices(
  supabase: SupabaseClient,
  invoices: PendingInvoice[],
  errors: string[]
): Promise<number> {
  if (invoices.length === 0) return 0;

  // 1. Fetch existing invoices for all involved meters to avoid duplicates
  const meterIds = Array.from(new Set(invoices.map((i) => i.meter_id)));
  const existingKeys = new Set<string>();

  // Fetch in chunks to avoid URL-length limits on large IN clauses
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
        // Template "deactivated" months are placeholders — real invoice data should replace them
        const st = (e.status || '').toUpperCase();
        if (st !== 'DEACTIVATED') {
          existingKeys.add(`${e.meter_id}__${e.period_start_date}__${e.period_end_date}`);
        }
      }
    }
  }

  // 2. Filter out duplicates (DB + within this upload batch)
  const seen = new Set<string>(Array.from(existingKeys));
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

  if (newInvoices.length === 0) {
    uploadLog(
      'batchInsertInvoices: all skipped (dedup). queued=',
      invoices.length,
      'existingKeys≈',
      existingKeys.size,
    );
    return 0;
  }

  // Remove deactivated placeholders for the same meter+period as incoming real rows
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

  uploadLog(
    'batchInsertInvoices: inserting',
    newInvoices.length,
    'of',
    invoices.length,
    'queued',
  );

  // 3. Insert in chunks
  let count = 0;
  for (let i = 0; i < newInvoices.length; i += BATCH_CHUNK_SIZE) {
    const chunk = newInvoices.slice(i, i + BATCH_CHUNK_SIZE);
    const { data, error } = await supabase
      .from('actual_invoices')
      .insert(chunk)
      .select('id');

    if (error) {
      console.error('Batch invoice insert failed:', error);
      errors.push(`Batch invoice insert failed: ${error.message}`);
    } else {
      count += data?.length ?? 0;
    }
  }
  return count;
}

// -------------------------------------------------------
// processRow — detailed invoice format.
// Collects invoices into pendingInvoices for batch insert.
// Returns a non-metered payload if category is non-metered.
// -------------------------------------------------------
async function processRow(
  ctx: UploadContext,
  row: CSVRow,
  rowNum: number,
  pendingInvoices: PendingInvoice[]
): Promise<{ type: 'non_metered'; payload: NonMeteredPayload } | void> {
  const missingFields: string[] = [];
  if (!row.Company?.trim()) missingFields.push('Company');
  if (!row.Category?.trim()) missingFields.push('Category');

  if (missingFields.length > 0) {
    throw new Error(`Missing required field(s): ${missingFields.join(', ')}`);
  }

  if (!row['Date Range']) {
    throw new Error('Missing Date Range');
  }

  const providerName = row.Provider?.trim() || null;

  const dateRange = parseDateRange(row['Date Range']);
  if (!dateRange) {
    throw new Error(`Invalid date range format: ${row['Date Range']}`);
  }

  const categoryName = mapUtilityToCategory(row.Category!);
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

  const facilityId = await cachedFindOrCreateFacility(
    ctx, facilityName, row['Supply Address']?.trim() || null,
  );

  const supplierId = providerName ? await cachedFindOrCreateSupplier(ctx, providerName) : null;

  if (is_metered === false) {
    return {
      type: 'non_metered',
      payload: {
        facilityId,
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
        status: 'IMPORTED',
      },
    };
  }

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

  const meterId = await cachedFindOrCreateMeter(ctx, {
    facilityId,
    supplierId,
    categoryId,
    identifierType,
    lookup1,
    lookup2,
  });

  // Check for duplicate invoice by invoice_number (requires DB check)
  if (row['Invoice Number'] && row['Invoice Number'].trim()) {
    const { data: existingInvoice } = await ctx.supabase
      .from('actual_invoices')
      .select('id')
      .eq('meter_id', meterId)
      .eq('invoice_number', row['Invoice Number'].trim())
      .maybeSingle();

    if (existingInvoice) return;
  }

  pendingInvoices.push({
    meter_id: meterId,
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
  });
}

// -------------------------------------------------------
// processNonMeteredBatch — batch upsert in chunks
// -------------------------------------------------------
async function processNonMeteredBatch(
  ctx: UploadContext,
  records: NonMeteredPayload[],
  errors: string[]
): Promise<number> {
  if (records.length === 0) return 0;

  // Register a non_metered_lines row for each distinct (facility, supplier, category) combination
  // so lines appear in the coverage grid even before/after records are written.
  const linePayloads = records
    .filter((r) => r.supplierId !== null)
    .map((r) => ({ facilityId: r.facilityId, supplierId: r.supplierId!, categoryId: r.categoryId }));
  try {
    await upsertNonMeteredLines(ctx.supabase, linePayloads);
  } catch (e) {
    errors.push(`Non-metered line registration failed: ${e instanceof Error ? e.message : String(e)}`);
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

  for (let i = 0; i < records.length; i += BATCH_CHUNK_SIZE) {
    const chunk = records.slice(i, i + BATCH_CHUNK_SIZE);
    const rows = chunk.map((rec) => ({
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
      status: rec.status || 'IMPORTED',
      inferred_from_id: null,
    }));

    const { data, error } = await ctx.supabase
      .from('non_metered_records')
      .upsert(rows, {
        onConflict: 'facility_id,supplier_id,utility_category_id,period_start_date,period_end_date',
      })
      .select('id, facility_id, supplier_id, utility_category_id, period_start_date, period_end_date, status');

    if (error) {
      errors.push(`Batch non-metered upsert failed: ${error.message}`);
    } else if (data) {
      successCount += data.length;
      for (const row of data) {
        upsertedIds.push({
          id: row.id,
          facilityId: row.facility_id,
          supplierId: row.supplier_id,
          categoryId: row.utility_category_id,
          periodStart: row.period_start_date,
          periodEnd: row.period_end_date,
          status: row.status as string,
        });
      }
    }
  }

  const inferenceSeeds = upsertedIds.filter((r) =>
    ['IMPORTED', 'MANUAL', 'CONFIRMED'].includes(r.status || ''),
  );
  await runInferenceForBatch(ctx.supabase, inferenceSeeds, errors);

  return successCount;
}

// -------------------------------------------------------
// Inference logic — batched where possible
// -------------------------------------------------------
async function runInferenceForBatch(
  supabase: SupabaseClient,
  upsertedRecords: Array<{
    id: string;
    facilityId: string;
    supplierId: string | null;
    categoryId: string;
    periodStart: string;
    periodEnd: string;
    status?: string;
  }>,
  errors: string[]
): Promise<void> {
  if (upsertedRecords.length === 0) return;

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

  // Collect all facility IDs across groups to fetch group memberships in one query
  const allPresentFacilityIds = new Set<string>();
  const supplierIds = new Set<string>();
  for (const group of Array.from(groups.values())) {
    if (!group.supplierId) continue;
    supplierIds.add(group.supplierId);
    for (const fid of Array.from(group.facilityIds)) allPresentFacilityIds.add(fid);
  }

  if (allPresentFacilityIds.size === 0) return;

  // Single query to get all relevant group memberships
  const { data: allGroupMembers, error: gmError } = await supabase
    .from('facility_group_members')
    .select('group_id, facility_id, facility_groups!inner(supplier_id)')
    .in('facility_id', Array.from(allPresentFacilityIds));

  if (gmError || !allGroupMembers?.length) return;

  // Pre-fetch all group members for referenced groups
  const relevantGroupIds = Array.from(new Set(allGroupMembers.map((m: any) => m.group_id)));
  const { data: allMembersData } = await supabase
    .from('facility_group_members')
    .select('group_id, facility_id')
    .in('group_id', relevantGroupIds);

  const membersByGroup = new Map<string, string[]>();
  for (const m of allMembersData || []) {
    if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, []);
    membersByGroup.get(m.group_id)!.push(m.facility_id);
  }

  // Collect all inference upserts, then batch them
  const inferenceRows: Array<{
    facility_id: string;
    supplier_id: string;
    utility_category_id: string;
    period_start_date: string;
    period_end_date: string;
    status: string;
    inferred_from_id: string;
  }> = [];

  for (const group of Array.from(groups.values())) {
    if (!group.supplierId) continue;

    const matchingGroupMembers = allGroupMembers.filter(
      (m: any) =>
        group.facilityIds.has(m.facility_id) &&
        (m.facility_groups as any)?.supplier_id === group.supplierId
    );

    if (!matchingGroupMembers.length) continue;

    const groupIds = Array.from(new Set(matchingGroupMembers.map((m: any) => m.group_id)));

    for (const groupId of groupIds) {
      const allMembers = membersByGroup.get(groupId) || [];
      const absentFacilityIds = allMembers.filter((fid) => !group.facilityIds.has(fid));

      for (const absentFacilityId of absentFacilityIds) {
        inferenceRows.push({
          facility_id: absentFacilityId,
          supplier_id: group.supplierId,
          utility_category_id: group.categoryId,
          period_start_date: group.periodStart,
          period_end_date: group.periodEnd,
          status: 'INFERRED_EMPTY',
          inferred_from_id: group.referenceId,
        });
      }
    }
  }

  // Batch upsert all inference records
  for (let i = 0; i < inferenceRows.length; i += BATCH_CHUNK_SIZE) {
    const chunk = inferenceRows.slice(i, i + BATCH_CHUNK_SIZE);
    const { error: inferError } = await supabase
      .from('non_metered_records')
      .upsert(chunk, {
        onConflict: 'facility_id,supplier_id,utility_category_id,period_start_date,period_end_date',
        ignoreDuplicates: true,
      });

    if (inferError) {
      errors.push(`Batch inference upsert failed: ${inferError.message}`);
    }
  }
}

// -------------------------------------------------------
// Parse month range like "Jul 2025 - Nov 2025"
// -------------------------------------------------------
function parseMonthRange(monthsWithData: string): { startDate: string; endDate: string } | null {
  if (!monthsWithData || !monthsWithData.trim()) return null;

  // Excel/docs often use en dash (U+2013) or em dash — normalise so split works.
  const normalised = monthsWithData
    .replace(/\u2013|\u2014|\u2212/g, '-')
    .trim();
  const parts = normalised
    .split('-')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
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
// Cached helpers — use in-memory cache, fallback to DB
// -------------------------------------------------------
function facilityCacheKey(name: string, address: string | null): string {
  return `${name.trim().toLowerCase()}__${(address || '').trim().toLowerCase()}`;
}

async function cachedFindOrCreateFacility(
  ctx: UploadContext,
  name: string,
  address: string | null,
): Promise<string> {
  const key = facilityCacheKey(name, address);
  const cached = ctx.facilityCache.get(key);
  if (cached) return cached;

  const { data: matches } = await ctx.supabase
    .from('facilities')
    .select('id, address, created_at')
    .eq('client_id', ctx.clientId)
    .ilike('name', name);

  const list = matches || [];
  let chosen: { id: string } | null = null;

  if (list.length === 1) {
    chosen = list[0];
  } else if (list.length > 1) {
    const addrNorm = (address || '').trim().toLowerCase();
    if (addrNorm) {
      const byAddr = list.find(
        (f) => (f.address || '').trim().toLowerCase() === addrNorm,
      );
      if (byAddr) chosen = byAddr;
      if (!chosen) {
        const partial = list.find((f) =>
          (f.address || '').toLowerCase().includes(addrNorm),
        );
        if (partial) chosen = partial;
      }
    }
    if (!chosen) {
      list.sort(
        (a, b) =>
          new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
      );
      chosen = list[0];
    }
  }

  if (chosen) {
    ctx.facilityCache.set(key, chosen.id);
    return chosen.id;
  }

  const { data: created, error } = await ctx.supabase
    .from('facilities')
    .insert([{ client_id: ctx.clientId, name, address }])
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create facility: ${error.message}`);

  ctx.facilityCache.set(key, created.id);
  return created.id;
}

async function cachedFindOrCreateSupplier(ctx: UploadContext, name: string): Promise<string> {
  const key = name.trim().toLowerCase();
  const cached = ctx.supplierCache.get(key);
  if (cached) return cached;

  const { data: existing } = await ctx.supabase
    .from('suppliers')
    .select('id')
    .ilike('name', name)
    .limit(1);

  if (existing && existing.length > 0) {
    ctx.supplierCache.set(key, existing[0].id);
    return existing[0].id;
  }

  const { data: created, error } = await ctx.supabase
    .from('suppliers')
    .insert([{ name }])
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate')) {
      const { data: retry } = await ctx.supabase
        .from('suppliers')
        .select('id')
        .ilike('name', name)
        .limit(1);
      if (retry && retry.length > 0) {
        ctx.supplierCache.set(key, retry[0].id);
        return retry[0].id;
      }
    }
    throw new Error(`Failed to create supplier: ${error.message}`);
  }

  ctx.supplierCache.set(key, created.id);
  return created.id;
}

async function cachedFindOrCreateCategory(
  ctx: UploadContext,
  name: string,
): Promise<{ id: string; is_metered: boolean; scope: number }> {
  const key = name.trim().toLowerCase();
  const classification = classifyCategory(name);

  // initContext pre-seeds this cache from DB. Legacy rows often still have migration
  // defaults (scope=2, is_metered=true). Without reconciling here, FUEL/LPG etc. hit
  // the cache and skip needsCorrection — they are routed as metered Scope 2 and never
  // written to non_metered_records (so Scope 1 non-metered stays empty).
  const cached = ctx.categoryCache.get(key);
  if (cached) {
    const needsCorrection =
      !classification.needs_review &&
      (cached.is_metered !== classification.is_metered || cached.scope !== classification.scope);
    if (needsCorrection) {
      await ctx.supabase
        .from('utility_categories')
        .update({
          scope: classification.scope,
          is_metered: classification.is_metered,
          needs_review: false,
        })
        .eq('id', cached.id);
      const result = {
        id: cached.id,
        is_metered: classification.is_metered,
        scope: classification.scope,
      };
      ctx.categoryCache.set(key, result);
      return result;
    }
    return cached;
  }

  const { data: existing } = await ctx.supabase
    .from('utility_categories')
    .select('id, is_metered, scope, needs_review')
    .ilike('name', name)
    .limit(1);

  if (existing && existing.length > 0) {
    const row = existing[0];

    const needsCorrection =
      !classification.needs_review &&
      (row.is_metered !== classification.is_metered || row.scope !== classification.scope);

    if (needsCorrection) {
      await ctx.supabase
        .from('utility_categories')
        .update({
          scope: classification.scope,
          is_metered: classification.is_metered,
          needs_review: false,
        })
        .eq('id', row.id);
      const result = {
        id: row.id,
        is_metered: classification.is_metered,
        scope: classification.scope,
      };
      ctx.categoryCache.set(key, result);
      return result;
    }

    const result = {
      id: row.id,
      is_metered: row.is_metered ?? true,
      scope: typeof row.scope === 'number' ? row.scope : 2,
    };
    ctx.categoryCache.set(key, result);
    return result;
  }

  const { data: created, error } = await ctx.supabase
    .from('utility_categories')
    .insert([{
      name,
      scope: classification.scope,
      is_metered: classification.is_metered,
      needs_review: classification.needs_review,
    }])
    .select('id, is_metered, scope')
    .single();

  if (error) {
    if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate')) {
      const { data: retry } = await ctx.supabase
        .from('utility_categories')
        .select('id, is_metered, scope')
        .ilike('name', name)
        .limit(1);
      if (retry && retry.length > 0) {
        const r = retry[0];
        const needsCorrection =
          !classification.needs_review &&
          (r.is_metered !== classification.is_metered || r.scope !== classification.scope);
        if (needsCorrection) {
          await ctx.supabase
            .from('utility_categories')
            .update({
              scope: classification.scope,
              is_metered: classification.is_metered,
              needs_review: false,
            })
            .eq('id', r.id);
        }
        const result = {
          id: r.id,
          is_metered: needsCorrection ? classification.is_metered : (r.is_metered ?? true),
          scope: needsCorrection ? classification.scope : (typeof r.scope === 'number' ? r.scope : 2),
        };
        ctx.categoryCache.set(key, result);
        return result;
      }
    }
    throw new Error(`Failed to create utility category: ${error.message}`);
  }

  const result = {
    id: created.id,
    is_metered: created.is_metered ?? true,
    scope: typeof created.scope === 'number' ? created.scope : classification.scope,
  };
  ctx.categoryCache.set(key, result);
  return result;
}

async function cachedFindOrCreateMeter(
  ctx: UploadContext,
  opts: {
    facilityId: string;
    supplierId: string | null;
    categoryId: string;
    identifierType: IdentifierType;
    lookup1: string;
    lookup2: string | null;
  },
): Promise<string> {
  const cacheKey = `${opts.facilityId}__${opts.categoryId}__${opts.identifierType}__${opts.lookup1}`;
  const looseCacheKey = `${opts.facilityId}__${opts.categoryId}__*__${opts.lookup1}`;
  const cachedExact = ctx.meterCache.get(cacheKey);
  if (cachedExact) return cachedExact;
  const cachedLoose = ctx.meterCache.get(looseCacheKey);
  if (cachedLoose) return cachedLoose;

  const { data: exactRows } = await ctx.supabase
    .from('meters')
    .select('id, identifier_type')
    .eq('facility_id', opts.facilityId)
    .eq('utility_category_id', opts.categoryId)
    .eq('identifier_type', opts.identifierType)
    .eq('lookup1', opts.lookup1)
    .limit(1);

  const exact = exactRows?.[0];
  if (exact) {
    rememberMeter(
      ctx,
      opts.facilityId,
      opts.categoryId,
      opts.lookup1,
      exact.id,
      opts.identifierType,
      exact.identifier_type as IdentifierType,
    );
    return exact.id;
  }

  // Reuse an existing meter with the same account/NMI at this facility+utility
  // (e.g. row was ACCOUNT_NUMBER from the UI; meter-setup infers NMI for Electricity).
  const { data: anyTypeRows } = await ctx.supabase
    .from('meters')
    .select('id, identifier_type')
    .eq('facility_id', opts.facilityId)
    .eq('utility_category_id', opts.categoryId)
    .eq('lookup1', opts.lookup1)
    .limit(1);

  const anyType = anyTypeRows?.[0];
  if (anyType) {
    rememberMeter(
      ctx,
      opts.facilityId,
      opts.categoryId,
      opts.lookup1,
      anyType.id,
      opts.identifierType,
      anyType.identifier_type as IdentifierType,
    );
    return anyType.id;
  }

  const { data: newMeter, error } = await ctx.supabase
    .from('meters')
    .insert([{
      facility_id: opts.facilityId,
      supplier_id: opts.supplierId,
      utility_category_id: opts.categoryId,
      identifier_type: opts.identifierType,
      lookup1: opts.lookup1,
      lookup2: opts.lookup2,
    }])
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      // Unique constraint conflict. Search only by lookup1 (no identifier_type filter) to handle
      // cases where the constraint is on just lookup1 or the stored type differs from inferred type.
      const { data: byLookup1 } = await ctx.supabase
        .from('meters')
        .select('id, facility_id, utility_category_id, identifier_type, lookup1')
        .eq('lookup1', opts.lookup1)
        .limit(1);
      const found = byLookup1?.[0];
      if (found) {
        const sameFacility = found.facility_id === opts.facilityId;
        const sameType = found.identifier_type === opts.identifierType;
        console.warn(
          '[upload] meter conflict: lookup1=%s inferred_type=%s stored_type=%s same_facility=%s facility_id=%s',
          opts.lookup1, opts.identifierType, found.identifier_type, sameFacility, found.facility_id,
        );
        if (sameFacility) {
          // Same facility — meter already set up, reuse it.
          rememberMeter(ctx, found.facility_id, found.utility_category_id, opts.lookup1, found.id,
            found.identifier_type as IdentifierType, opts.identifierType);
          return found.id;
        }
        throw new Error(
          `Meter identifier "${opts.lookup1}" (${opts.identifierType}) already exists for a different facility` +
          `${sameType ? '' : ` (stored as ${found.identifier_type})`}. ` +
          `Existing meter ID: ${found.id}, facility_id: ${found.facility_id}.`
        );
      }
      // lookup1 query also missed — constraint is on a different column or RLS blocked the read.
      throw new Error(
        `Duplicate meter identifier ${opts.identifierType} "${opts.lookup1}" — ` +
        `a meter with this value already exists but could not be retrieved (check DB constraint "unique_identifier").`
      );
    }
    throw new Error(`Failed to create meter: ${error.message}`);
  }

  rememberMeter(
    ctx,
    opts.facilityId,
    opts.categoryId,
    opts.lookup1,
    newMeter.id,
    opts.identifierType,
  );
  return newMeter.id;
}

function inferIdentifierType(utilityName: string): IdentifierType {
  const normalised = utilityName.trim().toUpperCase();
  if (keywordMatches(normalised, 'ELECTRICITY')) return 'NMI';
  if (keywordMatches(normalised, 'GAS')) return 'METER_NUMBER';
  return 'ACCOUNT_NUMBER';
}

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
  ctx: UploadContext,
  row: MeterSetupRow,
  rowNum: number,
  pendingInvoices: PendingInvoice[]
): Promise<
  | { type: 'non_metered'; payloads: NonMeteredPayload[] }
  | { type: 'pending_seeded'; created: number }
  | { type: 'meter_setup'; created: number }
  | void
> {
  const rawFacility = row.Facility?.trim() ?? '';
  let utilityName = row.Utility?.trim() ?? '';
  if (!utilityName) {
    if (isClientWideFacilityName(rawFacility)) {
      utilityName = 'Scope 3';
    } else {
      throw new Error('Missing Utility type');
    }
  }

  const supplierName = row.Supplier?.trim() || null;
  const address = row.Address?.trim() || null;
  const rowRec = row as Record<string, string | undefined>;

  const categoryName = mapUtilityToCategory(utilityName);
  const { id: categoryId, is_metered, scope } = await cachedFindOrCreateCategory(ctx, categoryName);

  let facilityName: string;
  if (!rawFacility) {
    if (scope === 3) facilityName = CLIENT_WIDE_FACILITY_NAME;
    else throw new Error('Missing Facility name');
  } else if (isClientWideFacilityName(rawFacility)) {
    facilityName = CLIENT_WIDE_FACILITY_NAME;
  } else {
    facilityName = rawFacility;
  }

  let monthsWithData =
    row.MonthsWithData?.trim() ||
    (() => {
      for (const [k, v] of Object.entries(rowRec)) {
        if (k.replace(/^\uFEFF/, '').trim().toLowerCase() === 'monthswithdata' && v?.trim()) {
          return v.trim();
        }
      }
      return '';
    })();

  let monthsDeactivated =
    row.MonthsDeactivated?.trim() ||
    (() => {
      for (const [k, v] of Object.entries(rowRec)) {
        if (k.replace(/^\uFEFF/, '').trim().toLowerCase() === 'monthsdeactivated' && v?.trim()) {
          return v.trim();
        }
      }
      return '';
    })();

  let dataRange: { startDate: string; endDate: string } | null = null;
  if (monthsWithData) {
    dataRange = parseMonthRange(monthsWithData);
    if (!dataRange) throw new Error(`Invalid MonthsWithData format: ${monthsWithData}`);
  }

  let deactivatedRange: { startDate: string; endDate: string } | null = null;
  if (monthsDeactivated) {
    deactivatedRange = parseMonthRange(monthsDeactivated);
    if (!deactivatedRange) throw new Error(`Invalid MonthsDeactivated format: ${monthsDeactivated}`);
  }

  const facilityId = await cachedFindOrCreateFacility(ctx, facilityName, address);
  const supplierId: string | null = supplierName
    ? await cachedFindOrCreateSupplier(ctx, supplierName)
    : null;

  // Scope 3: same as ingestion — seed PENDING months for current FY (per supplier + category).
  if (scope === 3 && is_metered === false) {
    if (!supplierId) {
      throw new Error('Missing Supplier for Scope 3 row');
    }
    const created = await upsertTemplateScope3CoverageMonths(ctx.supabase, {
      facilityId,
      supplierId,
      categoryId,
    });
    return { type: 'pending_seeded', created };
  }

  const dataPeriods = dataRange ? generateMonthlyPeriods(dataRange.startDate, dataRange.endDate) : [];
  const deactivatedPeriods = deactivatedRange
    ? generateMonthlyPeriods(deactivatedRange.startDate, deactivatedRange.endDate)
    : [];
  const dataMonthStarts = new Set(dataPeriods.map((p) => p.start));

  if (is_metered === false) {
    if (dataPeriods.length === 0 && deactivatedPeriods.length === 0) {
      // No period data — register the line so it appears in the grid with no-data state.
      if (supplierId) {
        await upsertNonMeteredLine(ctx.supabase, { facilityId, supplierId, categoryId });
      }
      return { type: 'meter_setup', created: 1 };
    }
    if (!supplierId) {
      throw new Error('Missing Supplier (required for non-metered Fuel/LPG/etc.)');
    }

    const base = {
      facilityId,
      supplierId,
      categoryId,
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
      ...dataPeriods.map((period) => ({
        ...base,
        periodStart: period.start,
        periodEnd: period.end,
        status: 'IMPORTED',
      })),
      ...deactivatedPeriods
        .filter((period) => !dataMonthStarts.has(period.start))
        .map((period) => ({
          ...base,
          periodStart: period.start,
          periodEnd: period.end,
          status: 'DEACTIVATED',
        })),
    ];
    return { type: 'non_metered', payloads };
  }

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

  const meterId = await cachedFindOrCreateMeter(ctx, {
    facilityId,
    supplierId,
    categoryId,
    identifierType,
    lookup1,
    lookup2: supplierName,
  });

  if (dataPeriods.length === 0 && deactivatedPeriods.length === 0) {
    // No period data — meter was created/found; count as setup only.
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
