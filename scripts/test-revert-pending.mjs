/**
 * Test helper for the metered revert-pending endpoint.
 *
 * Run with Node 20+ (loads .env.local via --env-file):
 *   node --env-file=.env.local scripts/test-revert-pending.mjs status
 *   node --env-file=.env.local scripts/test-revert-pending.mjs seed
 *   node --env-file=.env.local scripts/test-revert-pending.mjs clear
 *
 * Targets the "Test Client" / Origin / Electricity meters NMI 80001111 & 80002222.
 * `seed` inserts PENDING actual_invoices for FY26 + FY27 (24 months) per meter,
 * because the /api/ingestion/pending endpoint only seeds the current FY through
 * the current month. `clear` deletes every actual_invoice for both meters.
 */
import { createClient } from '@supabase/supabase-js';

const NMIS = ['80001111', '80002222'];
const CLIENT_NAME = 'Test Client';

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in env.');
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function resolveMeters(supabase) {
  const { data, error } = await supabase
    .from('meters')
    .select(`
      id, lookup1, identifier_type,
      supplier:suppliers(id, name),
      facility:facilities(id, name, client:clients(id, name)),
      input_type:input_types(id, name)
    `)
    .in('lookup1', NMIS);
  if (error) throw error;
  return data || [];
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function monthStart(year, monthZero) {
  return `${year}-${pad2(monthZero + 1)}-01`;
}

function monthEnd(year, monthZero) {
  const lastDay = new Date(Date.UTC(year, monthZero + 1, 0)).getUTCDate();
  return `${year}-${pad2(monthZero + 1)}-${pad2(lastDay)}`;
}

/** FY26 = Jul 2025..Jun 2026, FY27 = Jul 2026..Jun 2027 (24 months). */
function fy2627Months() {
  const out = [];
  for (let i = 0; i < 24; i++) {
    const year = 2025 + Math.floor((i + 6) / 12);
    const monthZero = (i + 6) % 12;
    out.push({ start: monthStart(year, monthZero), end: monthEnd(year, monthZero) });
  }
  return out;
}

async function showStatus(supabase) {
  const meters = await resolveMeters(supabase);
  if (meters.length === 0) {
    console.log(`No meters found with lookup1 in ${JSON.stringify(NMIS)}.`);
    console.log('Create Test Client / Origin / Electricity + the two NMIs first.');
    return;
  }
  for (const m of meters) {
    const clientName = m.facility?.client?.name;
    const supplierName = m.supplier?.name;
    const facName = m.facility?.name;
    const inputName = m.input_type?.name;
    const isTarget = clientName === CLIENT_NAME;
    console.log(
      `\nMeter ${m.lookup1} (${m.identifier_type}) ${isTarget ? '' : '[client mismatch: ' + clientName + ']'}`,
    );
    console.log(`  client=${clientName} supplier=${supplierName} facility=${facName} input=${inputName}`);
    const { data: inv, error } = await supabase
      .from('actual_invoices')
      .select('period_start_date, period_end_date, status, consumption')
      .eq('meter_id', m.id)
      .order('period_start_date', { ascending: true });
    if (error) throw error;
    if (!inv || inv.length === 0) {
      console.log('  actual_invoices: (none)');
    } else {
      for (const r of inv) {
        const mo = String(r.period_start_date).slice(0, 10);
        console.log(`  ${mo}  ${(r.status ?? '').padEnd(14)} ${r.consumption ?? ''}`);
      }
    }
  }
}

async function clearMeterRecords(supabase) {
  const meters = await resolveMeters(supabase);
  if (meters.length === 0) {
    console.log('No meters to clear.');
    return;
  }
  for (const m of meters) {
    const { count, error } = await supabase
      .from('actual_invoices')
      .delete({ count: 'exact' })
      .eq('meter_id', m.id);
    if (error) throw error;
    console.log(`Cleared ${count} actual_invoices for meter ${m.lookup1}.`);
  }
}

async function seedPending(supabase) {
  const meters = await resolveMeters(supabase);
  if (meters.length === 0) {
    console.log('No meters found. Nothing seeded.');
    return;
  }
  const months = fy2627Months();
  for (const m of meters) {
    if (m.facility?.client?.name !== CLIENT_NAME) {
      console.log(`Skipping meter ${m.lookup1} (client=${m.facility?.client?.name}, not Test Client).`);
      continue;
    }
    // Clean slate per meter so the test starts from a known state.
    const { error: delErr } = await supabase
      .from('actual_invoices')
      .delete()
      .eq('meter_id', m.id);
    if (delErr) throw delErr;
    const rows = months.map((mo) => ({
      meter_id: m.id,
      period_start_date: mo.start,
      period_end_date: mo.end,
      status: 'PENDING',
    }));
    const { error } = await supabase.from('actual_invoices').insert(rows);
    if (error) throw error;
    console.log(`Meter ${m.lookup1}: seeded ${rows.length} PENDING rows (FY26+FY27).`);
  }
}

const cmd = process.argv[2] || 'status';
const supabase = client();
if (cmd === 'status') {
  await showStatus(supabase);
} else if (cmd === 'seed') {
  await seedPending(supabase);
  await showStatus(supabase);
} else if (cmd === 'clear') {
  await clearMeterRecords(supabase);
  await showStatus(supabase);
} else {
  console.error(`Unknown command "${cmd}". Use: status | seed | clear`);
  process.exit(1);
}
