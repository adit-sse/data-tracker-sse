/**
 * Captures real p1EmailStaging rows for one week into a test fixture.
 *
 * The example workbook (Weekly-Data-Intake-Report-EXAMPLE.xlsx) tells us what
 * the answer should be — 33 received, 16 done, 9 action needed, 8 ignored — but
 * it only contains derived output, not the raw Processed/Completed values the
 * classifier reads. This script grabs those raw rows so the golden test in
 * scripts/test-intake-report.mjs can run offline and stay stable as the live
 * sheet moves on.
 *
 * Requires the Google credentials in .env.local. Run once, commit the result.
 *
 * Usage:
 *   node scripts/capture-intake-fixture.mjs                 # the example's week
 *   node scripts/capture-intake-fixture.mjs --week 2026-07-20
 *   node scripts/capture-intake-fixture.mjs --all           # every row, unfiltered
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

register('./ts-resolve-hooks.mjs', import.meta.url);

// Minimal .env.local reader — this project has no dotenv dependency.
function loadEnv() {
  const envPath = join(ROOT, '.env.local');
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

loadEnv();

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { week: '2026-07-20', all: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--week') out.week = args[++i];
    else if (args[i] === '--all') out.all = true;
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log(
        'Usage: node scripts/capture-intake-fixture.mjs [--week YYYY-MM-DD] [--all]',
      );
      process.exit(0);
    }
  }
  return out;
}

const { week, all } = parseArgs();

const { fetchSheetRows, isSheetsConfigured } = await import('@/lib/google-sheets');
const { STAGING_SHEET_ID, STAGING_TAB } = await import('@/lib/intake-report/config');
const { isInWeek, parseSheetTime } = await import('@/lib/intake-report/dates');

if (!isSheetsConfigured()) {
  console.error(
    'Google Sheets credentials not found.\n' +
      'Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env.local first.',
  );
  process.exit(1);
}

console.log(`Reading ${STAGING_TAB} from ${STAGING_SHEET_ID} …`);
const rows = await fetchSheetRows(STAGING_SHEET_ID, STAGING_TAB);
console.log(`  ${rows.length} rows total`);

// Print the header row once — this is how we confirm the sheet's real shape
// matches what the classifier expects.
if (rows.length > 0) {
  console.log('\nColumns present:');
  for (const key of Object.keys(rows[0])) console.log(`  - ${key}`);
}

const selected = all
  ? rows
  : rows.filter((row) => {
      const time = parseSheetTime(row.Time);
      return time !== null && isInWeek(time, week);
    });

console.log(`\n${selected.length} rows selected${all ? '' : ` for week ${week}`}`);

if (selected.length === 0) {
  console.error('\nNothing to write. Check the week, or run with --all to inspect the sheet.');
  process.exit(1);
}

const rowNumbers = selected.map((r) => r.row_number);
console.log(`Staging rows ${Math.min(...rowNumbers)}–${Math.max(...rowNumbers)}`);

const outDir = join(HERE, 'fixtures');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const outPath = join(outDir, all ? 'staging-all.json' : `staging-week-${week}.json`);
writeFileSync(outPath, `${JSON.stringify(selected, null, 2)}\n`, 'utf8');

console.log(`\nWrote ${outPath}`);
console.log('Now run: node scripts/test-intake-report.mjs');
