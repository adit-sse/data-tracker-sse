export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import type { UploadResult } from '@/types';

import { parseUploadFile } from '@/lib/upload/parse';
import { detectUploadFormat, applyMeterSetupCarryDown } from '@/lib/upload/spreadsheet';
import { initContext } from '@/lib/upload/resolver';
import { processRow } from '@/lib/upload/process-invoice-row';
import { processMeterSetupRow } from '@/lib/upload/process-meter-setup-row';
import { batchInsertInvoices, processNonMeteredBatch } from '@/lib/upload/batch-insert';
import type { NonMeteredPayload, PendingInvoice } from '@/lib/upload/types';
import type { CSVRow, MeterSetupRow } from '@/types';

const UPLOAD_DEBUG = process.env.UPLOAD_DEBUG === '1';

function uploadLog(...args: unknown[]) {
  if (!UPLOAD_DEBUG) return;
  console.log('[upload]', ...args);
}

// POST /api/clients/[id]/upload
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // --- Parse file ---
    let rows: Record<string, string>[];
    try {
      rows = await parseUploadFile(file);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Failed to parse file' },
        { status: 400 },
      );
    }

    // --- Auth + client access ---
    const authClient = createSupabaseServerClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();
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

    // Upload performs many writes; promote to service role after session proves access.
    const db = createSupabaseServiceRoleClient();
    const ctx = await initContext(db, params.id);

    // --- Format detection + spreadsheet quirk handling ---
    const headers = Object.keys(rows[0]);
    const format = detectUploadFormat(headers);
    const isMeterSetupFormat = format === 'meter-setup';

    if (isMeterSetupFormat) {
      applyMeterSetupCarryDown(rows);
    }

    uploadLog('file=', file.name, 'format=', format, 'rows=', rows.length);

    // --- Row processing ---
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
        } else {
          const result = await processRow(ctx, row as unknown as CSVRow, rowNum, pendingInvoices);
          if (result?.type === 'non_metered') {
            nonMeteredBatch.push(result.payload);
          }
        }
      } catch (error) {
        errors.push(`Row ${rowNum}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // --- Batch writes ---
    if (pendingInvoices.length > 0) {
      const invoiceCount = await batchInsertInvoices(db, pendingInvoices, errors);
      imported += invoiceCount;
      uploadLog('pendingInvoices=', pendingInvoices.length, 'inserted=', invoiceCount);
    }

    if (nonMeteredBatch.length > 0) {
      const nonMeteredImported = await processNonMeteredBatch(ctx, nonMeteredBatch, errors);
      imported += nonMeteredImported;
    }

    console.info(
      '[upload] client=%s file=%s format=%s rows=%s pendingInvoices=%s imported=%s metersSetup=%s errors=%s',
      params.id,
      file.name,
      format,
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
