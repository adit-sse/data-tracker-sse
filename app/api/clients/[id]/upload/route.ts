export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { parseDateRange } from '@/lib/coverage';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { CSVRow, MeterSetupRow, UploadResult, IdentifierType } from '@/types';
import {
  CLIENT_WIDE_FACILITY_NAME,
  isClientWideFacilityName,
} from '@/lib/client-wide-facility';
import { keywordMatches } from '@/lib/utility-category-classification';
import { upsertTemplateScope3CoverageMonths } from '@/lib/non-metered-pending-seed';
import { upsertNonMeteredLine, upsertNonMeteredLines } from '@/lib/non-metered-lines';
import { parse, isValid } from 'date-fns';

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

/** First letter uppercase, rest lowercase (sentence case) for input type labels from spreadsheets. */
function toSentenceCase(s: string): string {
  const t = s.trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

// -------------------------------------------------------
// Request-scoped caches to avoid redundant DB round-trips
// -------------------------------------------------------
interface UploadContext {
  supabase: SupabaseClient;
  clientId: string;
  facilityCache: Map<string, string>;
  supplierCache: Map<string, string>;
  /** input_types.name → metadata (legacy name "categoryCache") */
  categoryCache: Map<string, { id: string; is_metered: boolean; scope: number }>;
  /** categories.name (lower) → NGERS reporting group */
  reportingCategoryCache: Map<string, { id: string; scope: number }>;
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
    reportingCategoryCache: new Map(),
    meterCache: new Map(),
  };

  const [facilitiesRes, suppliersRes, inputTypesRes, reportingCategoriesRes] = await Promise.all([
    ctx.supabase.from('facilities').select('id, name, address').eq('client_id', clientId),
    ctx.supabase.from('suppliers').select('id, name'),
    ctx.supabase.from('input_types').select('id, name, is_metered, scope, needs_review'),
    ctx.supabase.from('categories').select('id, name, scope'),
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
  for (const c of inputTypesRes.data || []) {
    ctx.categoryCache.set(c.name.trim().toLowerCase(), {
      id: c.id,
      is_metered: c.is_metered ?? true,
      scope: typeof c.scope === 'number' ? c.scope : 2,
    });
  }
  for (const c of reportingCategoriesRes.data || []) {
    ctx.reportingCategoryCache.set(c.name.trim().toLowerCase(), {
      id: c.id,
      scope: typeof c.scope === 'number' ? c.scope : 1,
    });
  }

  const facilityIds = (facilitiesRes.data || []).map((f: any) => f.id);
  if (facilityIds.length > 0) {
    const { data: meters } = await ctx.supabase
      .from('meters')
      .select('id, facility_id, input_type_id, identifier_type, lookup1')
      .in('facility_id', facilityIds);
    for (const m of meters || []) {
      rememberMeter(
        ctx,
        m.facility_id,
        m.input_type_id,
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
  /** input_types.id (legacy field name) */
  categoryId: string;
  /** public.categories.id when Scope 1 / 3 */
  reportingCategoryId?: string | null;
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

    const authClient = createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clientIdNum = Number(params.id);
    if (!Number.isFinite(clientIdNum)) {
      return NextResponse.json({ error: 'Invalid client id' }, { status: 400 });
    }

    const { data: clientRow, error: clientError } = await authClient
      .from('clients')
      .select('id')
      .eq('id', clientIdNum)
      .maybeSingle();

    if (clientError || !clientRow) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Upload performs many writes; use service role after session proves access to this client
    // (same bar as RLS: clients_select uses user_can_access_client).
    const db = createSupabaseServiceRoleClient();
    const ctx = await initContext(db, params.id);

    const firstRow = rows[0];
    const headers = Object.keys(firstRow);
    const looksLikeInvoiceFormat =
      headers.some((h) => h === 'Company') && headers.some((h) => h === 'Date Range');
    const isMeterSetupFormat =
      !looksLikeInvoiceFormat &&
      (headers.some((h) => h === 'Utility' || h === 'MonthsWithData') ||
        headers.some((h) => h === 'Input Type'));

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
        Category: rows[0].Category,
        'Input Type': rows[0]['Input Type'],
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
      const invoiceCount = await batchInsertInvoices(db, pendingInvoices, errors);
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

  const facilityId = await cachedFindOrCreateFacility(
    ctx, facilityName, row['Supply Address']?.trim() || null,
  );

  const supplierId = providerName ? await cachedFindOrCreateSupplier(ctx, providerName) : null;

  const inputTypeColRaw = row['Input Type']?.trim();
  const inputTypeCol = inputTypeColRaw ? toSentenceCase(inputTypeColRaw) : null;

  if (is_metered === false) {
    return {
      type: 'non_metered',
      payload: {
        facilityId,
        supplierId,
        categoryId,
        reportingCategoryId: null,
        invoiceNumber: row['Invoice Number']?.trim() || null,
        invoiceDate: row['Invoice Date']?.trim() || null,
        periodStart: dateRange.startDate,
        periodEnd: dateRange.endDate,
        consumption: row.Consumption ? parseFloat(row.Consumption) : null,
        unit: row['Unit Type']?.trim() || null,
        amount: row['Amount($)'] ? parseFloat(row['Amount($)'].replace(/[^0-9.-]/g, '')) : null,
        subCategory: row['Sub-category']?.trim() || null,
        inputType: inputTypeCol,
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
    lookup2 = inputTypeCol;
  } else if (row.MIRN && row.MIRN.trim()) {
    identifierType = 'MIRN';
    lookup1 = row.MIRN.trim();
    lookup2 = inputTypeCol;
  } else if (row['Account Number'] && row['Account Number'].trim()) {
    identifierType = 'ACCOUNT_NUMBER';
    lookup1 = row['Account Number'].trim();
    lookup2 = inputTypeCol;
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
    reportingCategoryId: null,
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
    input_type: inputTypeCol,
    emissions_factor: row['Output (tCO2-e)'] ? parseFloat(row['Output (tCO2-e)']) : null,
    customer: row.Customer?.trim() || null,
    status: 'IMPORTED',
  });
}

/**
 * Same key as non_metered_records upsert onConflict:
 * facility_id, supplier_id, input_type_id, period_start_date, period_end_date.
 * Postgres errors if one INSERT touches the same row twice — dedupe before upsert.
 */
function nonMeteredUpsertConflictKey(rec: NonMeteredPayload): string {
  const sid = rec.supplierId ?? '';
  return `${rec.facilityId}__${sid}__${rec.categoryId}__${rec.periodStart}__${rec.periodEnd}`;
}

function nonMeteredPayloadPriority(rec: NonMeteredPayload): number {
  const s = (rec.status || 'IMPORTED').toUpperCase();
  const order: Record<string, number> = {
    IMPORTED: 100,
    MANUAL: 95,
    CONFIRMED: 90,
    DEACTIVATED: 50,
    PENDING: 40,
    INFERRED_EMPTY: 30,
    ERROR: 10,
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

// -------------------------------------------------------
// processNonMeteredBatch — batch upsert in chunks
// -------------------------------------------------------
async function processNonMeteredBatch(
  ctx: UploadContext,
  records: NonMeteredPayload[],
  errors: string[]
): Promise<number> {
  if (records.length === 0) return 0;

  const deduped = dedupeNonMeteredForUpsert(records);

  // Register a non_metered_lines row for each distinct (facility, supplier, category) combination
  // so lines appear in the coverage grid even before/after records are written.
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

  // Auto-create facility groups for scope 1 non-metered rows where
  // multiple facilities share the same supplier + reporting category.
  await autoCreateNonMeteredGroups(ctx, deduped, errors);

  const inferenceSeeds = upsertedIds.filter((r) =>
    ['IMPORTED', 'MANUAL', 'CONFIRMED'].includes(r.status || ''),
  );
  await runInferenceForBatch(ctx.supabase, inferenceSeeds, errors);

  return successCount;
}

// -------------------------------------------------------
// Auto-create facility groups for scope 1 non-metered rows
// where multiple facilities share the same supplier + reporting category.
// -------------------------------------------------------
async function autoCreateNonMeteredGroups(
  ctx: UploadContext,
  records: NonMeteredPayload[],
  errors: string[],
): Promise<void> {
  // Build inputTypeId → scope reverse map from the category cache (name → {id, scope}).
  const inputTypeIdToScope = new Map<string, number>();
  for (const [, meta] of ctx.categoryCache) {
    inputTypeIdToScope.set(meta.id, meta.scope);
  }

  // Filter to scope 1, non-metered, with both a supplier and a reporting category.
  const scope1 = records.filter(
    (r) =>
      r.supplierId !== null &&
      r.reportingCategoryId !== null &&
      inputTypeIdToScope.get(r.categoryId) === 1,
  );

  if (scope1.length === 0) return;

  // Group by (supplierId, reportingCategoryId), collecting all distinct facility IDs and
  // distinct non-metered lines (facilityId + inputTypeId pairs).
  // A group is created when 2+ distinct lines share the same supplier + reporting category —
  // this covers both "same facility, two fuel types" and "two facilities, same fuel type".
  type GroupEntry = {
    supplierId: string;
    reportingCategoryId: string;
    facilityIds: Set<string>;
    lineKeys: Set<string>; // `${facilityId}__${inputTypeId}`
  };

  const groupMap = new Map<string, GroupEntry>();

  for (const rec of scope1) {
    const key = `${rec.supplierId}__${rec.reportingCategoryId}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        supplierId: rec.supplierId!,
        reportingCategoryId: rec.reportingCategoryId!,
        facilityIds: new Set(),
        lineKeys: new Set(),
      });
    }
    const entry = groupMap.get(key)!;
    entry.facilityIds.add(rec.facilityId);
    entry.lineKeys.add(`${rec.facilityId}__${rec.categoryId}`);
  }

  // Only act on groups where 2+ distinct lines appear.
  const multiGroups = Array.from(groupMap.values()).filter((g) => g.lineKeys.size >= 2);
  if (multiGroups.length === 0) return;

  // Fetch supplier + category names for group naming.
  const supplierIds = Array.from(new Set(multiGroups.map((g) => g.supplierId)));
  const categoryIds = Array.from(new Set(multiGroups.map((g) => g.reportingCategoryId)));

  const [{ data: supplierRows }, { data: categoryRows }] = await Promise.all([
    ctx.supabase.from('suppliers').select('id, name').in('id', supplierIds),
    ctx.supabase.from('categories').select('id, name').in('id', categoryIds),
  ]);

  const supplierNameById = new Map<string, string>();
  for (const s of supplierRows ?? []) supplierNameById.set(s.id, s.name);

  const categoryNameById = new Map<string, string>();
  for (const c of categoryRows ?? []) categoryNameById.set(c.id, c.name);

  // Load existing facility_groups to avoid creating duplicates.
  // Join through non_metered_lines to get member facility IDs.
  const { data: existingGroups, error: egError } = await ctx.supabase
    .from('facility_groups')
    .select(`id, supplier_id, members:facility_group_members(line:non_metered_lines(facility_id))`)
    .eq('client_id', ctx.clientId);

  if (egError) {
    errors.push(`Auto-group: failed to load existing groups: ${egError.message}`);
    return;
  }

  // Map supplierId → list of existing groups with their member facility IDs.
  type ExistingGroup = { id: string; facilityIds: Set<string> };
  const existingBySupplier = new Map<string, ExistingGroup[]>();
  for (const eg of existingGroups ?? []) {
    const members =
      (eg.members as unknown as Array<{ line: { facility_id: string } | null }>) ?? [];
    const facilityIds = new Set(members.map((m) => m.line?.facility_id).filter(Boolean) as string[]);
    if (!existingBySupplier.has(eg.supplier_id)) {
      existingBySupplier.set(eg.supplier_id, []);
    }
    existingBySupplier.get(eg.supplier_id)!.push({ id: String(eg.id), facilityIds });
  }

  for (const g of multiGroups) {
    const existing = existingBySupplier.get(g.supplierId) ?? [];
    const facilityIds = Array.from(g.facilityIds);

    // Skip if any existing group already contains all of these facilities for this supplier.
    const alreadyCovered = existing.some((eg) =>
      facilityIds.every((fid) => eg.facilityIds.has(fid)),
    );
    if (alreadyCovered) continue;

    const supplierName = supplierNameById.get(g.supplierId) ?? 'Unknown Supplier';
    const categoryName = categoryNameById.get(g.reportingCategoryId) ?? 'Unknown Category';
    const groupName = `${supplierName} - ${categoryName}`;

    const { data: newGroup, error: createError } = await ctx.supabase
      .from('facility_groups')
      .insert([{
        client_id: ctx.clientId,
        supplier_id: g.supplierId,
        category_id: g.reportingCategoryId,
        name: groupName,
      }])
      .select('id')
      .single();

    if (createError) {
      errors.push(`Auto-group: failed to create group "${groupName}": ${createError.message}`);
      continue;
    }

    // Look up all non_metered_lines for this supplier + reporting category + facilities.
    // This correctly yields one row per (facility, input_type) combination, so a facility
    // with both Diesel and Gasoline lines becomes two separate member rows.
    const { data: memberLines, error: linesError } = await ctx.supabase
      .from('non_metered_lines')
      .select('id')
      .eq('supplier_id', g.supplierId)
      .eq('category_id', g.reportingCategoryId)
      .in('facility_id', facilityIds);

    if (linesError) {
      errors.push(`Auto-group: failed to look up member lines for "${groupName}": ${linesError.message}`);
      continue;
    }

    if (!memberLines?.length) {
      errors.push(`Auto-group: no non_metered_lines found for group "${groupName}" — members skipped`);
      continue;
    }

    const { error: membersError } = await ctx.supabase
      .from('facility_group_members')
      .upsert(
        memberLines.map((l) => ({ group_id: newGroup.id, non_metered_line_id: l.id })),
        { onConflict: 'group_id,non_metered_line_id', ignoreDuplicates: true },
      );

    if (membersError) {
      errors.push(
        `Auto-group: failed to add members to group "${groupName}": ${membersError.message}`,
      );
    }
  }
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

  // Find non_metered_line IDs for the uploaded facilities, then look up group memberships.
  const { data: presentLines } = await supabase
    .from('non_metered_lines')
    .select('id, facility_id')
    .in('facility_id', Array.from(allPresentFacilityIds));

  const presentLineIds = (presentLines ?? []).map((l: any) => String(l.id));
  if (presentLineIds.length === 0) return;

  // Single query to get all relevant group memberships via line join
  const { data: allGroupMembers, error: gmError } = await supabase
    .from('facility_group_members')
    .select('group_id, non_metered_line_id, line:non_metered_lines(facility_id), group:facility_groups(supplier_id)')
    .in('non_metered_line_id', presentLineIds);

  if (gmError || !allGroupMembers?.length) return;

  // Pre-fetch all group members for referenced groups, also via line join
  const relevantGroupIds = Array.from(new Set(allGroupMembers.map((m: any) => m.group_id)));
  const { data: allMembersData } = await supabase
    .from('facility_group_members')
    .select('group_id, line:non_metered_lines(facility_id)')
    .in('group_id', relevantGroupIds);

  const membersByGroup = new Map<string, string[]>();
  for (const m of (allMembersData || []) as any[]) {
    const facilityId = m.line?.facility_id;
    if (!facilityId) continue;
    if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, []);
    membersByGroup.get(m.group_id)!.push(String(facilityId));
  }

  // Collect all inference upserts, then batch them
  const inferenceRows: Array<{
    facility_id: string;
    supplier_id: string;
    input_type_id: string;
    period_start_date: string;
    period_end_date: string;
    status: string;
    inferred_from_id: string;
  }> = [];

  for (const group of Array.from(groups.values())) {
    if (!group.supplierId) continue;

    const matchingGroupMembers = allGroupMembers.filter(
      (m: any) =>
        group.facilityIds.has((m.line as any)?.facility_id) &&
        (m.group as any)?.supplier_id === group.supplierId
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
          input_type_id: group.categoryId,
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
        onConflict: 'facility_id,supplier_id,input_type_id,period_start_date,period_end_date',
        ignoreDuplicates: true,
      });

    if (inferError) {
      errors.push(`Batch inference upsert failed: ${inferError.message}`);
    }
  }
}

// -------------------------------------------------------
// Parse month ranges — supports semicolon-separated segments.
// Each segment can be:
//   "Mon YYYY" or "Month YYYY"   — single month, e.g. "Jan 2026" or "January 2026"
//   "Mon YYYY - Mon YYYY"        — range, e.g. "Jul 2025 - Jun 2026" or "July 2025 - June 2026"
// Multiple segments are joined with ";", e.g.:
//   "Jul 2025 - Nov 2025; Jan 2026"   (Dec 2025 is a gap)
//   "Jul 2025 - Nov 2025; Jan 2026 - Mar 2026"
// -------------------------------------------------------
function _normalizeMonthYearToken(str: string): string {
  const trimmed = str.trim().replace(/\s+/g, ' ');
  const m = trimmed.match(/^(.+?)\s+(\d{4})$/);
  if (!m) return trimmed;
  const [, name, year] = m;
  const titled =
    name.length <= 3
      ? name.slice(0, 1).toUpperCase() + name.slice(1).toLowerCase()
      : name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  return `${titled} ${year}`;
}

function _parseMonthYear(str: string): { month: number; year: number } | null {
  const normalized = _normalizeMonthYearToken(str);
  if (!normalized) return null;
  const ref = new Date(2000, 0, 1);
  let d = parse(normalized, 'MMM yyyy', ref);
  if (!isValid(d)) d = parse(normalized, 'MMMM yyyy', ref);
  if (!isValid(d)) return null;
  return { month: d.getMonth(), year: d.getFullYear() };
}

function _monthYearToDates(my: { month: number; year: number }): { startDate: string; endDate: string } {
  const startDate = `${my.year}-${String(my.month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(my.year, my.month + 1, 0).getDate();
  const endDate = `${my.year}-${String(my.month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
}

/** Parse one segment: either "Mon YYYY" or "Mon YYYY - Mon YYYY". */
function _parseOneSegment(segment: string): { startDate: string; endDate: string } | null {
  // Normalise en/em dashes so splitting works.
  const normalised = segment.replace(/\u2013|\u2014|\u2212/g, '-').trim();

  // Try as a range (exactly 2 parts when split by "-").
  const parts = normalised.split('-').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 2) {
    const start = _parseMonthYear(parts[0]);
    const end = _parseMonthYear(parts[1]);
    if (start && end) {
      return { startDate: _monthYearToDates(start).startDate, endDate: _monthYearToDates(end).endDate };
    }
  }

  // Try as a single month.
  const single = _parseMonthYear(normalised);
  if (single) return _monthYearToDates(single);

  return null;
}

/**
 * Parse MonthsWithData / MonthsDeactivated into an array of date ranges.
 * Returns null when the string is empty or any segment is invalid.
 */
function parseMonthRanges(input: string): Array<{ startDate: string; endDate: string }> | null {
  if (!input?.trim()) return null;
  const segments = input.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  const ranges: Array<{ startDate: string; endDate: string }> = [];
  for (const segment of segments) {
    const range = _parseOneSegment(segment);
    if (!range) return null;
    ranges.push(range);
  }
  return ranges;
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
/** Collapse NBSP / trim so CSV/Excel quirks do not break name matching vs DB. */
function normalizeFacilityName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/\u00A0/g, ' ')
    .trim();
}

function facilityCacheKey(name: string, address: string | null): string {
  return `${normalizeFacilityName(name).toLowerCase()}__${(address || '').trim().toLowerCase()}`;
}

async function cachedFindOrCreateFacility(
  ctx: UploadContext,
  name: string,
  address: string | null,
): Promise<string> {
  const displayName = normalizeFacilityName(name);
  if (!displayName) {
    throw new Error('Missing Facility name');
  }

  const key = facilityCacheKey(displayName, address);
  const cached = ctx.facilityCache.get(key);
  if (cached) return cached;

  const { data: matches } = await ctx.supabase
    .from('facilities')
    .select('id, address, created_at')
    .eq('client_id', ctx.clientId)
    .ilike('name', displayName);

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
    .insert([{ client_id: ctx.clientId, name: displayName, address }])
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate')) {
      const { data: retry } = await ctx.supabase
        .from('facilities')
        .select('id')
        .eq('client_id', ctx.clientId)
        .ilike('name', displayName)
        .limit(2);
      const found = retry?.[0];
      if (found) {
        ctx.facilityCache.set(key, found.id);
        return found.id;
      }
    }
    throw new Error(`Failed to create facility: ${error.message}`);
  }

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

/**
 * Look up an input_type by name from the cache (pre-seeded from DB at upload start).
 * Throws if not found — Input Types must be pre-defined; no auto-creation on upload.
 */
async function cachedFindOrCreateCategory(
  ctx: UploadContext,
  name: string,
): Promise<{ id: string; is_metered: boolean; scope: number }> {
  const normalizedName = toSentenceCase(name);
  const key = normalizedName.toLowerCase();

  const cached = ctx.categoryCache.get(key);
  if (cached) return cached;

  // Fallback DB lookup (handles case sensitivity variations not in cache)
  const { data: existing } = await ctx.supabase
    .from('input_types')
    .select('id, is_metered, scope')
    .ilike('name', normalizedName)
    .limit(1);

  if (existing && existing.length > 0) {
    const row = existing[0];
    const result = {
      id: row.id,
      is_metered: row.is_metered ?? true,
      scope: typeof row.scope === 'number' ? row.scope : 2,
    };
    ctx.categoryCache.set(key, result);
    return result;
  }

  throw new Error(
    `Unknown Input Type: "${normalizedName}". Please create it in Manage Input Types before uploading.`
  );
}

/**
 * Resolve public.categories row for NGERS grouping (Scope 1, 2, and 3).
 * Category may be left blank; when set, it must match the input type's scope
 * (e.g. Scope 2 electricity uses the ELECTRICITY reporting category from migration 011).
 */
async function cachedResolveReportingCategory(
  ctx: UploadContext,
  rawName: string | undefined,
  inputTypeScope: number,
): Promise<string | null> {
  const trimmed = rawName?.trim() ?? '';
  if (!trimmed) return null;

  const key = trimmed.toLowerCase();
  let row = ctx.reportingCategoryCache.get(key);
  if (!row) {
    const { data: existing } = await ctx.supabase
      .from('categories')
      .select('id, name, scope')
      .ilike('name', trimmed)
      .limit(2);

    if (!existing?.length) {
      throw new Error(
        `Unknown Category (reporting group): "${trimmed}". Create it under Categories or correct the spelling.`,
      );
    }
    if (existing.length > 1) {
      throw new Error(
        `Category "${trimmed}" matches multiple reporting groups. Use the exact Category name from your database.`,
      );
    }
    const c = existing[0];
    row = { id: c.id, scope: typeof c.scope === 'number' ? c.scope : 1 };
    ctx.reportingCategoryCache.set(c.name.trim().toLowerCase(), row);
  }

  if (inputTypeScope === 1 && row.scope !== 1) {
    throw new Error(`Category "${trimmed}" is Scope ${row.scope}, but this Input Type is Scope 1.`);
  }
  if (inputTypeScope === 2 && row.scope !== 2) {
    throw new Error(`Category "${trimmed}" is Scope ${row.scope}, but this Input Type is Scope 2.`);
  }
  if (inputTypeScope === 3 && row.scope !== 3) {
    throw new Error(`Category "${trimmed}" is Scope ${row.scope}, but this Input Type is Scope 3.`);
  }

  return row.id;
}

async function cachedFindOrCreateMeter(
  ctx: UploadContext,
  opts: {
    facilityId: string;
    supplierId: string | null;
    categoryId: string;
    reportingCategoryId?: string | null;
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
    .eq('input_type_id', opts.categoryId)
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
    .eq('input_type_id', opts.categoryId)
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
      input_type_id: opts.categoryId,
      category_id: opts.reportingCategoryId ?? null,
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
        .select('id, facility_id, input_type_id, identifier_type, lookup1')
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
          rememberMeter(ctx, found.facility_id, found.input_type_id, opts.lookup1, found.id,
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
  const rowRec = row as Record<string, string | undefined>;

  const inputTypeCell = (() => {
    const direct = row['Input Type']?.trim();
    if (direct) return direct;
    for (const [k, v] of Object.entries(rowRec)) {
      if (k.replace(/^\uFEFF/, '').trim().toLowerCase() === 'input type' && v?.trim()) {
        return v.trim();
      }
    }
    return '';
  })();

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

  const reportingCategoryCell = (() => {
    const direct = row.Category?.trim();
    if (direct) return direct;
    for (const [k, v] of Object.entries(rowRec)) {
      if (k.replace(/^\uFEFF/, '').trim().toLowerCase() === 'category' && v?.trim()) {
        return v.trim();
      }
    }
    return '';
  })();

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

  // Scope 3: same as ingestion — seed PENDING months for current FY (per supplier + category).
  if (scope === 3 && is_metered === false) {
    if (!supplierId) {
      throw new Error('Missing Supplier for Scope 3 row');
    }
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
      // No period data — register the line so it appears in the grid with no-data state.
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
    if (!supplierId) {
      throw new Error('Missing Supplier (required for non-metered Fuel/LPG/etc.)');
    }

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
    identifierType = inferIdentifierType(inputTypeName);
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
