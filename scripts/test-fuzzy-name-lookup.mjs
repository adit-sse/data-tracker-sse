/**
 * Smoke tests for fuzzy client/supplier/facility name resolution (Postgres RPC).
 *
 * Safe default: read-only GET endpoints only (pending-mode, mixed-scope).
 * Optional write tests (--allow-writes) seed PENDING rows — use on dev/staging only.
 *
 * Usage:
 *   INGESTION_API_KEY=... node scripts/test-fuzzy-name-lookup.mjs
 *   BASE_URL=https://data-tracker-d8bml80tv-adit-sses-projects.vercel.app INGESTION_API_KEY=... node scripts/test-fuzzy-name-lookup.mjs
 *   node scripts/test-fuzzy-name-lookup.mjs --client "Test Client" --supplier "BFcards"
 *   node scripts/test-fuzzy-name-lookup.mjs --allow-writes   # dev/staging only
 *
 * Env:
 *   BASE_URL            App URL (default http://localhost:3000)
 *   INGESTION_API_KEY   Bearer token for ingestion routes
 */

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const API_KEY = process.env.INGESTION_API_KEY;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    client: 'Test Client',
    supplier: 'BFcards',
    allowWrites: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--client') out.client = args[++i];
    else if (args[i] === '--supplier') out.supplier = args[++i];
    else if (args[i] === '--allow-writes') out.allowWrites = true;
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`Usage: node scripts/test-fuzzy-name-lookup.mjs [options]

Options:
  --client NAME       Exact client in DB (default: Test Client)
  --supplier NAME     Exact supplier in DB (default: BFcards)
  --allow-writes      Also run POST /pending (creates PENDING rows)
  --help              Show this help

Env: BASE_URL, INGESTION_API_KEY`);
      process.exit(0);
    }
  }
  return out;
}

function fuzzyVariants(exact) {
  const lower = exact.toLowerCase();
  const typo =
    exact.length > 3 ? exact.slice(0, -1) : exact;
  const extraSpace = exact.includes(' ')
    ? exact.replace(' ', '  ')
    : `${exact} `;
  return [...new Set([lower, typo, extraSpace.trim() === exact ? `${exact} ` : extraSpace])];
}

async function api(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    Accept: 'application/json',
  };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  return { status: res.status, json, url };
}

function pass(label) {
  console.log(`  ✓ ${label}`);
  return true;
}

function fail(label, detail) {
  console.log(`  ✗ ${label}`);
  if (detail) console.log(`    ${detail}`);
  return false;
}

async function runCase(name, fn) {
  process.stdout.write(`\n${name}\n`);
  try {
    return await fn();
  } catch (e) {
    fail('threw', e instanceof Error ? e.message : String(e));
    return false;
  }
}

async function main() {
  const opts = parseArgs();

  if (!API_KEY) {
    console.error('Error: INGESTION_API_KEY is required.');
    process.exit(1);
  }

  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Fixture:  client="${opts.client}" supplier="${opts.supplier}"`);
  console.log(`Mode:     ${opts.allowWrites ? 'read + write' : 'read-only (safe for prod)'}`);

  let passed = 0;
  let failed = 0;

  const track = (ok) => (ok ? (passed++, true) : (failed++, false));

  // ── 1. Exact names (baseline) ─────────────────────────────────────────────
  await runCase('1. Baseline — exact names (GET pending-mode)', async () => {
    const q = new URLSearchParams({
      client_name: opts.client,
      supplier_name: opts.supplier,
    });
    const { status, json } = await api('GET', `/api/ingestion/pending-mode?${q}`);
    if (status !== 200) {
      return track(
        fail(`expected 200, got ${status}`, json?.error ?? JSON.stringify(json))
      );
    }
    return track(pass(`200 — groups/lines payload returned`));
  });

  await runCase('2. Baseline — exact names (GET mixed-scope)', async () => {
    const q = new URLSearchParams({
      client_name: opts.client,
      supplier_name: opts.supplier,
    });
    const { status, json } = await api('GET', `/api/ingestion/mixed-scope?${q}`);
    if (status !== 200) {
      return track(
        fail(`expected 200, got ${status}`, json?.error ?? JSON.stringify(json))
      );
    }
    return track(pass(`200 — scope mix returned`));
  });

  // ── 2. Fuzzy client + supplier ────────────────────────────────────────────
  for (const [label, clientName, supplierName] of [
    ['lowercase', opts.client.toLowerCase(), opts.supplier.toLowerCase()],
    ['client typo (drop last char)', opts.client.slice(0, -1), opts.supplier],
    ['supplier typo', opts.client, opts.supplier.slice(0, -1)],
    ['extra spaces', `  ${opts.client}  `, `  ${opts.supplier}  `],
  ]) {
    await runCase(`3. Fuzzy (${label}) — GET pending-mode`, async () => {
      const q = new URLSearchParams({ client_name: clientName, supplier_name: supplierName });
      const { status, json } = await api('GET', `/api/ingestion/pending-mode?${q}`);
      if (status !== 200) {
        return track(
          fail(`expected 200, got ${status}`, json?.error ?? JSON.stringify(json))
        );
      }
      return track(pass(`200 with "${clientName}" / "${supplierName}"`));
    });
  }

  // ── 3. Negative — should 404 ───────────────────────────────────────────────
  await runCase('4. Negative — unknown client should 404', async () => {
    const q = new URLSearchParams({
      client_name: 'ZZZ No Such Client 999',
      supplier_name: opts.supplier,
    });
    const { status, json } = await api('GET', `/api/ingestion/pending-mode?${q}`);
    if (status !== 404) {
      return track(fail(`expected 404, got ${status}`, JSON.stringify(json)));
    }
    return track(pass('404 as expected'));
  });

  // ── 4. Optional write test ─────────────────────────────────────────────────
  if (opts.allowWrites) {
    await runCase('5. Write — POST pending with fuzzy names', async () => {
      const { status, json } = await api('POST', '/api/ingestion/pending', {
        client_name: opts.client.toLowerCase(),
        supplier_name: opts.supplier.toLowerCase(),
      });
      if (status !== 200 && status !== 201) {
        return track(
          fail(`expected 200/201, got ${status}`, json?.error ?? JSON.stringify(json))
        );
      }
      return track(pass(`pending seeded (${status})`));
    });
  } else {
    console.log('\n5. Write tests skipped (pass --allow-writes on dev/staging to enable)');
  }

  console.log(`\n─── Results: ${passed} passed, ${failed} failed ───`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
