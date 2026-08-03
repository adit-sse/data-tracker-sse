/**
 * READ-ONLY diagnostic for the revert-pending 404:
 *   No non_metered_lines row for client "Megasorber", supplier "AGL", utility "Electricity".
 *
 * Answers two questions:
 *   1. Which code path produced it — line mode (scope_kind='line') or metered mode
 *      with facility_name omitted (scope_kind='metered')? Read from ingestion_events.
 *   2. What coverage actually exists for this pair — meters vs non_metered_lines,
 *      and how ELECTRICITY is classified in input_types.
 *
 * Performs SELECTs only. No inserts, updates, or deletes.
 *
 *   node --env-file=.env.local scripts/diagnose-megasorber-agl.mjs
 */
import { createClient } from '@supabase/supabase-js';

const CLIENT_MATCH = 'megasorber';
const SUPPLIER_MATCH = 'agl';
const UTILITY_MATCH = 'electricity';
const EVENT_LIMIT = 25;

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in env.');
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function head(title) {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}

function embed(raw) {
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] ?? null : raw;
}

async function q(label, promise) {
  const { data, error } = await promise;
  if (error) {
    console.log(`  [query failed: ${label}] ${error.message}`);
    return null;
  }
  return data;
}

const supabase = client();

// ── 1. ingestion_events — what did n8n actually send? ────────────────────────
head('1. ingestion_events for Megasorber (most recent first)');

const events = await q(
  'ingestion_events',
  supabase
    .from('ingestion_events')
    .select('created_at, endpoint, outcome, scope_kind, http_status, client_name, supplier_name, facility_name, utility_name, reason, affected_count, payload_excerpt')
    .ilike('client_name', `%${CLIENT_MATCH}%`)
    .order('created_at', { ascending: false })
    .limit(EVENT_LIMIT)
);

if (!events || events.length === 0) {
  console.log('  (no events with that client_name — trying a reason-text search instead)');
  const byReason = await q(
    'ingestion_events by reason',
    supabase
      .from('ingestion_events')
      .select('created_at, endpoint, outcome, scope_kind, http_status, client_name, supplier_name, reason, payload_excerpt')
      .ilike('reason', '%non_metered_lines row for client%')
      .order('created_at', { ascending: false })
      .limit(EVENT_LIMIT)
  );
  for (const e of byReason ?? []) {
    console.log(`\n  ${e.created_at}  ${e.endpoint}  ${e.outcome} ${e.http_status ?? ''}  scope_kind=${e.scope_kind ?? 'null'}`);
    console.log(`    client=${e.client_name} supplier=${e.supplier_name}`);
    console.log(`    reason: ${e.reason}`);
    console.log(`    payload: ${JSON.stringify(e.payload_excerpt)}`);
  }
} else {
  for (const e of events) {
    const flag = e.endpoint === 'revert-pending' ? ' <<< revert-pending' : '';
    console.log(`\n  ${e.created_at}  ${e.endpoint}  ${e.outcome} ${e.http_status ?? ''}  scope_kind=${e.scope_kind ?? 'null'}${flag}`);
    console.log(`    supplier=${e.supplier_name ?? '-'} facility=${e.facility_name ?? '-'} utility=${e.utility_name ?? '-'} affected=${e.affected_count ?? '-'}`);
    if (e.reason) console.log(`    reason: ${e.reason}`);
    console.log(`    payload: ${JSON.stringify(e.payload_excerpt)}`);
  }
}

// ── 2. Resolve client + supplier ─────────────────────────────────────────────
head('2. Client / supplier rows');

const clients = await q('clients', supabase.from('clients').select('id, name').ilike('name', `%${CLIENT_MATCH}%`));
const suppliers = await q('suppliers', supabase.from('suppliers').select('id, name').ilike('name', `%${SUPPLIER_MATCH}%`));

console.log('  clients matching "megasorber":');
for (const c of clients ?? []) console.log(`    id=${c.id}  name="${c.name}"`);
console.log('  suppliers matching "agl":');
for (const s of suppliers ?? []) console.log(`    id=${s.id}  name="${s.name}"`);

const theClient = (clients ?? [])[0];
const theSupplier = (suppliers ?? []).find((s) => s.name.toLowerCase() === SUPPLIER_MATCH) ?? (suppliers ?? [])[0];

if (!theClient || !theSupplier) {
  console.log('\n  Cannot continue without both a client and a supplier match.');
  process.exit(0);
}

// ── 3. ELECTRICITY in input_types / categories ───────────────────────────────
head('3. How "Electricity" is classified');

const inputTypes = await q('input_types', supabase.from('input_types').select('*').ilike('name', `%${UTILITY_MATCH}%`));
for (const it of inputTypes ?? []) {
  console.log(`  input_types: id=${it.id} name="${it.name}" scope=${it.scope} is_metered=${it.is_metered}`);
}
const categories = await q('categories', supabase.from('categories').select('*').ilike('name', `%${UTILITY_MATCH}%`));
for (const c of categories ?? []) {
  console.log(`  categories:  id=${c.id} name="${c.name}" scope=${c.scope}`);
}

// ── 4. Facilities, meters, non-metered lines for this pair ───────────────────
head('4. Coverage for Megasorber + AGL');

const facilities = await q('facilities', supabase.from('facilities').select('id, name').eq('client_id', theClient.id));
const facilityIds = (facilities ?? []).map((f) => f.id);
console.log(`  facilities for client (${facilityIds.length}):`);
for (const f of facilities ?? []) console.log(`    id=${f.id}  "${f.name}"`);

const meters = facilityIds.length
  ? await q(
      'meters',
      supabase
        .from('meters')
        .select('id, facility_id, supplier_id, input_type_id, identifier_type, lookup1, lookup2, input_type:input_types(name, scope, is_metered)')
        .in('facility_id', facilityIds)
        .eq('supplier_id', theSupplier.id)
    )
  : [];

console.log(`\n  METERS for this client+supplier (${meters?.length ?? 0}):`);
const facName = new Map((facilities ?? []).map((f) => [String(f.id), f.name]));
for (const m of meters ?? []) {
  const it = embed(m.input_type);
  console.log(
    `    meter id=${m.id} facility="${facName.get(String(m.facility_id)) ?? m.facility_id}" ` +
      `input_type="${it?.name}" (scope=${it?.scope} is_metered=${it?.is_metered}) ` +
      `${m.identifier_type ?? '-'} ${m.lookup1 ?? '-'}${m.lookup2 ? ' / ' + m.lookup2 : ''}`
  );
}

const lines = facilityIds.length
  ? await q(
      'non_metered_lines',
      supabase
        .from('non_metered_lines')
        .select('id, facility_id, supplier_id, input_type_id, category_id, input_type:input_types(name, scope, is_metered)')
        .in('facility_id', facilityIds)
        .eq('supplier_id', theSupplier.id)
    )
  : [];

console.log(`\n  NON_METERED_LINES for this client+supplier (${lines?.length ?? 0}):`);
for (const l of lines ?? []) {
  const it = embed(l.input_type);
  console.log(
    `    line id=${l.id} facility="${facName.get(String(l.facility_id)) ?? l.facility_id}" ` +
      `input_type="${it?.name}" (scope=${it?.scope} is_metered=${it?.is_metered}) category_id=${l.category_id ?? '-'}`
  );
}
if ((lines?.length ?? 0) === 0) {
  console.log('    (none — this is why resolveIngestionLine 404s when facility_name is omitted)');
}

// ── 5. Leftover PENDING state ────────────────────────────────────────────────
head('5. Outstanding PENDING state (what revert-pending was meant to clear)');

const meterIds = (meters ?? []).map((m) => String(m.id));
if (meterIds.length) {
  const slots = await q(
    'meter_month_slots',
    supabase.from('meter_month_slots').select('meter_id, status, month_start').in('meter_id', meterIds)
  );
  const counts = new Map();
  for (const s of slots ?? []) counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
  console.log(`  meter_month_slots for these meters (${slots?.length ?? 0} rows):`);
  for (const [status, n] of counts) console.log(`    ${status}: ${n}`);
  const pending = (slots ?? []).filter((s) => s.status === 'PENDING');
  if (pending.length) {
    const months = pending.map((s) => String(s.month_start).slice(0, 10)).sort();
    console.log(`    PENDING months: ${months[0]} … ${months[months.length - 1]}`);
  }
} else {
  console.log('  (no meters — skipping slot check)');
}

if (facilityIds.length) {
  const nmr = await q(
    'non_metered_records',
    supabase
      .from('non_metered_records')
      .select('id, status')
      .in('facility_id', facilityIds)
      .eq('supplier_id', theSupplier.id)
  );
  const counts = new Map();
  for (const r of nmr ?? []) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  console.log(`\n  non_metered_records for this client+supplier (${nmr?.length ?? 0} rows):`);
  for (const [status, n] of counts) console.log(`    ${status}: ${n}`);
}

console.log('\nDone (read-only).');
