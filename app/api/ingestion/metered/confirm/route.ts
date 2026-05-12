import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/service';
import { parseNgersDateRange, monthStartIso } from '@/lib/ingestion-dates';
import {
  parseMeterIdentifierFromNgersRow,
  resolveMeterForIngestion,
  meteredExactDuplicateExists,
  type NgersMeterRow,
} from '@/lib/ingestion-metered';
import { getCurrentFiscalYearMonthsThroughNow } from '@/lib/non-metered-pending-seed';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function checkApiKey(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === process.env.INGESTION_API_KEY;
}

function periodKey(d: string | null | undefined): string {
  if (!d) return '';
  return String(d).slice(0, 10);
}

function metaFromRow(row: NgersMeterRow) {
  return {
    invoice_number:
      typeof row['Invoice Number'] === 'string' && row['Invoice Number'].trim()
        ? String(row['Invoice Number']).trim()
        : null,
    invoice_date:
      typeof row['Invoice Date'] === 'string' && row['Invoice Date'].trim()
        ? String(row['Invoice Date']).trim()
        : null,
    framework:
      typeof row.Framework === 'string' && row.Framework.trim() ? String(row.Framework).trim() : null,
    version: typeof row.Version === 'string' && row.Version.trim() ? String(row.Version).trim() : null,
    input_type:
      typeof row['Input Type'] === 'string' && row['Input Type'].trim()
        ? String(row['Input Type']).trim()
        : null,
    customer: typeof row.Customer === 'string' && row.Customer.trim() ? String(row.Customer).trim() : null,
  };
}

// POST /api/ingestion/metered/confirm
// Body: { "rows": [ NGERS-style rows ... ] }
// Updates PENDING placeholder months to CONFIRMED with exact period dates from Date Range;
// removes other FY pendings for that meter.
//
// All lookup failures (client, facility, supplier, input type, meter, date range) return
// a hard 4xx — nothing is silently skipped.
export async function POST(request: Request) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const body = await request.json();
    if (!body || typeof body !== 'object' || !Array.isArray(body.rows)) {
      return NextResponse.json({ error: 'Body must be { "rows": [ ... NGERS rows ] }' }, { status: 400 });
    }

    const rows = body.rows as NgersMeterRow[];
    if (rows.length === 0) {
      return NextResponse.json({ error: 'rows must be non-empty' }, { status: 400 });
    }

    const groupedRows = new Map<string, NgersMeterRow[]>();

    for (const row of rows) {
      const iden = parseMeterIdentifierFromNgersRow(row);
      if (!iden.ok) {
        return NextResponse.json({ error: iden.error }, { status: 400 });
      }
      const company = String(row.Company ?? '').trim();
      const provider = String(row.Provider ?? '').trim();
      const category = String(row.Category ?? '').trim();
      const fac = String(row.Facility ?? '').trim();
      if (!company || !provider || !category) {
        return NextResponse.json(
          { error: 'Row missing Company, Provider, or Category' },
          { status: 400 }
        );
      }
      const key = `${company}__${provider}__${category}__${fac}__${iden.identifier_type}__${iden.lookup1}`;
      if (!groupedRows.has(key)) groupedRows.set(key, []);
      groupedRows.get(key)!.push(row);
    }

    let totalConfirmed = 0;
    let totalDeletedPending = 0;
    let totalSkippedDuplicates = 0;

    const confirmedAt = new Date().toISOString();

    for (const [, groupRows] of Array.from(groupedRows.entries())) {
      const first = groupRows[0];
      const iden = parseMeterIdentifierFromNgersRow(first);
      if (!iden.ok) {
        return NextResponse.json({ error: iden.error }, { status: 400 });
      }

      const resolved = await resolveMeterForIngestion(supabase, {
        clientName: String(first.Company ?? '').trim(),
        facilityName: String(first.Facility ?? '').trim(),
        supplierName: String(first.Provider ?? '').trim(),
        utilityName: String(first.Category ?? '').trim(),
        identifierType: iden.identifier_type,
        lookup1: iden.lookup1,
        lookup2: iden.lookup2,
      });

      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: resolved.status });
      }

      const { meterId } = resolved;

      const { data: allPending, error: pendErr } = await supabase
        .from('actual_invoices')
        .select('id, period_start_date')
        .eq('meter_id', meterId)
        .eq('status', 'PENDING');

      if (pendErr) throw new Error(pendErr.message);

      const confirmedPeriods = new Map<string, { start: string; end: string }>();
      const periodTotals = new Map<string, { consumption: number; amount: number }>();
      const monthKeysConfirmed = new Set<string>();

      for (const row of groupRows) {
        if (!row['Date Range']) {
          return NextResponse.json({ error: 'Row is missing Date Range' }, { status: 422 });
        }
        const parsed = parseNgersDateRange(String(row['Date Range']));
        if (!parsed) {
          return NextResponse.json(
            {
              error: `Could not parse Date Range "${row['Date Range']}" — expected format: "DD/MM/YYYY - DD/MM/YYYY"`,
            },
            { status: 422 }
          );
        }
        confirmedPeriods.set(parsed.start, parsed);
        monthKeysConfirmed.add(monthStartIso(parsed.start));
        const prev = periodTotals.get(parsed.start) ?? { consumption: 0, amount: 0 };
        periodTotals.set(parsed.start, {
          consumption: prev.consumption + (Number(row.Consumption) || 0),
          amount: prev.amount + (Number(row['Amount ($)']) || 0),
        });
      }

      if (confirmedPeriods.size === 0) continue;

      const meta = metaFromRow(first);

      for (const [periodStartKey, period] of Array.from(confirmedPeriods.entries())) {
        const totals = periodTotals.get(periodStartKey) ?? { consumption: 0, amount: 0 };
        const monthStart = monthStartIso(periodStartKey);

        const { data: pendingList } = await supabase
          .from('actual_invoices')
          .select('id')
          .eq('meter_id', meterId)
          .eq('status', 'PENDING')
          .eq('period_start_date', monthStart);

        const pendings = pendingList ?? [];

        if (pendings.length > 0) {
          const keepId = pendings[0].id;
          const dupIds = pendings.slice(1).map((p) => p.id);

          const { error: updErr } = await supabase
            .from('actual_invoices')
            .update({
              period_start_date: period.start,
              period_end_date: period.end,
              consumption: totals.consumption,
              amount: totals.amount,
              status: 'CONFIRMED',
              confirmed_at: confirmedAt,
              invoice_number: meta.invoice_number,
              invoice_date: meta.invoice_date,
              framework: meta.framework,
              version: meta.version,
              input_type: meta.input_type,
              customer: meta.customer,
            })
            .eq('id', keepId);

          if (updErr) throw new Error(updErr.message);

          if (dupIds.length > 0) {
            const { error: delDupErr } = await supabase.from('actual_invoices').delete().in('id', dupIds);
            if (delDupErr) throw new Error(delDupErr.message);
            totalDeletedPending += dupIds.length;
          }
          totalConfirmed++;
        } else {
          const isDuplicate = await meteredExactDuplicateExists(supabase, meterId, period.start, period.end);
          if (isDuplicate) {
            // Idempotent: already confirmed — safe to skip
            totalSkippedDuplicates++;
            continue;
          }

          const { error: insErr } = await supabase.from('actual_invoices').insert({
            meter_id: meterId,
            period_start_date: period.start,
            period_end_date: period.end,
            consumption: totals.consumption,
            amount: totals.amount,
            status: 'CONFIRMED',
            confirmed_at: confirmedAt,
            invoice_number: meta.invoice_number,
            invoice_date: meta.invoice_date,
            framework: meta.framework,
            version: meta.version,
            input_type: meta.input_type,
            customer: meta.customer,
          });

          if (insErr) throw new Error(insErr.message);
          totalConfirmed++;
        }
      }

      const fyMonthStarts = new Set(getCurrentFiscalYearMonthsThroughNow().map((m) => m.start));
      const orphaned = (allPending ?? []).filter((r) => {
        const pk = periodKey(r.period_start_date);
        return !monthKeysConfirmed.has(pk) && fyMonthStarts.has(pk);
      });

      if (orphaned.length > 0) {
        const orphanIds = orphaned.map((r) => r.id);
        const { error: delErr } = await supabase.from('actual_invoices').delete().in('id', orphanIds);
        if (delErr) throw new Error(delErr.message);
        totalDeletedPending += orphanIds.length;
      }
    }

    return NextResponse.json({
      mode: 'metered',
      confirmed: totalConfirmed,
      deleted_pending: totalDeletedPending,
      skipped_duplicates: totalSkippedDuplicates,
    });
  } catch (error) {
    console.error('Error in ingestion/metered/confirm:', error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Internal server error', detail }, { status: 500 });
  }
}
