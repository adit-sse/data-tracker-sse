/**
 * Acceptance timing test for ARCH-5 N+1 fix.
 *
 * Verifies that pending-seed and coverage load for a large client (≥100 meters,
 * full FY) complete within defined time budgets.
 *
 * Usage:
 *   node scripts/timing-test.mjs
 *   node scripts/timing-test.mjs --client "Acme Corp" --supplier "Origin Energy"
 *   node scripts/timing-test.mjs --pending-budget 5000 --coverage-budget 3000
 *
 * Env required:
 *   NEXT_PUBLIC_SUPABASE_URL       — Supabase project URL (used to find large client)
 *   SUPABASE_SERVICE_ROLE_KEY      — Service role key for direct DB queries
 *   INGESTION_API_KEY              — Bearer token for POST /api/ingestion/pending
 *   BASE_URL                       — App base URL, defaults to http://localhost:3000
 */

import { createClient } from '@supabase/supabase-js';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_KEY = process.env.INGESTION_API_KEY;

// Default budgets (ms). Pass --pending-budget / --coverage-budget to override.
const DEFAULT_PENDING_BUDGET_MS = 5000;
const DEFAULT_COVERAGE_BUDGET_MS = 3000;
const MIN_METERS_FOR_LARGE = 100;

function getSupabase() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    process.exit(1);
  }
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    clientName: null,
    supplierName: null,
    pendingBudget: DEFAULT_PENDING_BUDGET_MS,
    coverageBudget: DEFAULT_COVERAGE_BUDGET_MS,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--client') result.clientName = args[++i];
    else if (args[i] === '--supplier') result.supplierName = args[++i];
    else if (args[i] === '--pending-budget') result.pendingBudget = Number(args[++i]);
    else if (args[i] === '--coverage-budget') result.coverageBudget = Number(args[++i]);
  }
  return result;
}

/**
 * Find a client+supplier pair with the most meters (≥100).
 * Queries actual_invoices grouped by meter → facility → client to find the heaviest pair.
 */
async function findLargeClientSupplier(supabase) {
  // Find clients with many meters via a join approach
  const { data: meters, error } = await supabase
    .from('meters')
    .select('id, supplier_id, facility:facilities(id, client_id, client:clients(id, name)), supplier:suppliers(id, name)')
    .limit(5000);

  if (error) throw new Error(`Failed to fetch meters: ${error.message}`);

  // Count meters per (client_id, supplier_id) pair
  const counts = new Map();
  for (const m of meters ?? []) {
    const clientId = m.facility?.client_id;
    const supplierId = m.supplier_id;
    const clientName = m.facility?.client?.name;
    const supplierName = m.supplier?.name;
    if (!clientId || !supplierId || !clientName || !supplierName) continue;
    const key = `${clientId}::${supplierId}`;
    const prev = counts.get(key);
    if (!prev) {
      counts.set(key, { clientId, supplierId, clientName, supplierName, count: 1 });
    } else {
      prev.count++;
    }
  }

  const sorted = Array.from(counts.values()).sort((a, b) => b.count - a.count);
  const best = sorted[0];

  if (!best) {
    console.error('No meters found in the database. Seed some data first.');
    process.exit(1);
  }
  if (best.count < MIN_METERS_FOR_LARGE) {
    console.warn(
      `Warning: largest client+supplier pair has only ${best.count} meters (minimum is ${MIN_METERS_FOR_LARGE}).`
    );
    console.warn('Results may not represent a production-scale workload.');
  }

  return best;
}

/**
 * Find the client ID for a given client name.
 */
async function findClientId(supabase, clientName) {
  const { data, error } = await supabase
    .from('clients')
    .select('id')
    .ilike('name', clientName)
    .limit(1)
    .single();
  if (error) throw new Error(`Client "${clientName}" not found: ${error.message}`);
  return data.id;
}

async function timeRequest(label, fn, budgetMs) {
  const start = Date.now();
  const result = await fn();
  const elapsed = Date.now() - start;
  const pass = elapsed <= budgetMs;
  const status = pass ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${label}: ${elapsed}ms (budget: ${budgetMs}ms)`);
  if (!pass) {
    console.log(`         Over budget by ${elapsed - budgetMs}ms`);
  }
  return { elapsed, pass, result };
}

async function main() {
  const args = parseArgs();
  const supabase = getSupabase();

  let clientName = args.clientName;
  let supplierName = args.supplierName;
  let clientId;

  if (clientName && supplierName) {
    console.log(`\nUsing specified client: "${clientName}" / "${supplierName}"`);
    clientId = await findClientId(supabase, clientName);
  } else {
    console.log('\nSearching for largest client+supplier pair...');
    const best = await findLargeClientSupplier(supabase);
    clientName = best.clientName;
    supplierName = best.supplierName;
    clientId = best.clientId;
    console.log(`Found: "${clientName}" / "${supplierName}" — ${best.count} meters`);
  }

  // Count meters for this pair to show in output
  const { count: meterCount } = await supabase
    .from('meters')
    .select('id', { count: 'exact', head: true })
    .in(
      'facility_id',
      (
        await supabase
          .from('facilities')
          .select('id')
          .eq('client_id', clientId)
      ).data?.map((f) => f.id) ?? []
    );

  console.log(`\nTiming test for client "${clientName}" (id=${clientId}, ~${meterCount ?? '?'} meters)`);
  console.log('='.repeat(70));

  let allPass = true;

  // ── Test 1: POST /api/ingestion/pending ─────────────────────────────────
  if (!API_KEY) {
    console.log('\n  [SKIP] pending-seed — INGESTION_API_KEY not set');
  } else {
    console.log('\nTest 1: pending-seed (POST /api/ingestion/pending)');
    const { pass: pendingPass } = await timeRequest(
      'pending-seed',
      async () => {
        const res = await fetch(`${BASE_URL}/api/ingestion/pending`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
          },
          body: JSON.stringify({ client_name: clientName, supplier_name: supplierName }),
        });
        const body = await res.json();
        if (!res.ok) {
          console.error(`    HTTP ${res.status}:`, JSON.stringify(body));
        } else {
          const m = body.metered ?? {};
          console.log(`    metered: meters=${m.meters ?? '-'} created=${m.created ?? '-'} skipped=${m.skipped ?? '-'}`);
        }
        return body;
      },
      args.pendingBudget
    );
    if (!pendingPass) allPass = false;
  }

  // ── Test 2: GET /api/clients/[id]/coverage ───────────────────────────────
  console.log('\nTest 2: coverage load (GET /api/clients/[id]/coverage)');
  const { pass: coveragePass } = await timeRequest(
    'coverage',
    async () => {
      const res = await fetch(`${BASE_URL}/api/clients/${clientId}/coverage`);
      const body = await res.json();
      if (!res.ok) {
        console.error(`    HTTP ${res.status}:`, JSON.stringify(body));
      } else {
        console.log(`    meters in response: ${body.meters?.length ?? '?'}, fiscalYear: ${body.fiscalYear ?? '?'}`);
      }
      return body;
    },
    args.coverageBudget
  );
  if (!coveragePass) allPass = false;

  console.log('\n' + '='.repeat(70));
  if (allPass) {
    console.log('All tests PASSED.\n');
    process.exit(0);
  } else {
    console.log('One or more tests FAILED. Check output above.\n');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
