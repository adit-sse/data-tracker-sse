/**
 * Diagnoses the Google Sheets connection for the data intake dashboard.
 *
 * Google's failures here are opaque and all look alike from the outside — a bad
 * key, an unshared sheet, and a disabled API produce three unrelated errors that
 * each say very little. This script names which one you have and what to do
 * about it.
 *
 * Usage:
 *   node scripts/check-google-sheets.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

register('./ts-resolve-hooks.mjs', import.meta.url);

// Minimal .env.local reader — this project has no dotenv dependency.
function loadEnv() {
  const envPath = join(ROOT, '.env.local');
  if (!existsSync(envPath)) {
    console.error('No .env.local found. Copy .env.local.example and fill it in.');
    process.exit(1);
  }

  // Values may be quoted and may contain '=', so split on the first one only.
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

const ok = (msg) => console.log(`  [32m✓[0m ${msg}`);
const bad = (msg) => console.log(`  [31m✗[0m ${msg}`);
const info = (msg) => console.log(`    ${msg}`);

let failed = false;

// ---------------------------------------------------------------------------
// 1. Credentials present and shaped correctly
// ---------------------------------------------------------------------------

console.log('\n1. Credentials');

const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
const rawKey = process.env.GOOGLE_PRIVATE_KEY?.trim();

if (!email) {
  bad('GOOGLE_SERVICE_ACCOUNT_EMAIL is not set');
  info('Find it in the downloaded JSON key as "client_email".');
  failed = true;
} else if (!email.endsWith('.iam.gserviceaccount.com')) {
  bad(`GOOGLE_SERVICE_ACCOUNT_EMAIL looks wrong: ${email}`);
  info('It should end in .iam.gserviceaccount.com — this is not your own Google address.');
  failed = true;
} else {
  ok(`Service account: ${email}`);
}

if (!rawKey) {
  bad('GOOGLE_PRIVATE_KEY is not set');
  failed = true;
} else {
  const key = rawKey.replace(/\\n/g, '\n');

  if (!key.includes('-----BEGIN PRIVATE KEY-----')) {
    bad('GOOGLE_PRIVATE_KEY has no PEM header');
    info('Copy the full "private_key" value from the JSON, including -----BEGIN PRIVATE KEY-----.');
    failed = true;
  } else if (!key.includes('\n')) {
    bad('GOOGLE_PRIVATE_KEY has no line breaks');
    info('Keep the literal \\n sequences from the JSON file and wrap the value in double quotes.');
    failed = true;
  } else {
    ok(`Private key parsed (${key.split('\n').filter(Boolean).length} lines)`);
  }
}

if (failed) {
  console.log('\nFix the above, then re-run.\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Token exchange — proves the key itself is valid
// ---------------------------------------------------------------------------

console.log('\n2. Authentication');

const { fetchSheetRows } = await import('@/lib/google-sheets');
const { STAGING_SHEET_ID, STAGING_TAB, TICKETS_SHEET_ID, TICKETS_TAB } = await import(
  '@/lib/intake-report/config'
);

/** Turns Google's opaque errors into the thing you actually need to change. */
function explain(message, sheetLabel) {
  if (/DECODER routines|unsupported/i.test(message)) {
    return [
      'The private key could not be decoded.',
      'Usually the \\n escapes were lost. Re-copy the "private_key" value from the JSON key file.',
    ];
  }
  if (/Invalid JWT Signature|invalid_grant/i.test(message)) {
    return [
      'Google rejected the signature.',
      'The key and the service account email are from different accounts, or the key was deleted/rotated.',
    ];
  }
  if (/has not been used in project|SERVICE_DISABLED|accessNotConfigured/i.test(message)) {
    return [
      'The Google Sheets API is not enabled on this project.',
      'GCP console → APIs & Services → Library → "Google Sheets API" → Enable. Wait ~1 minute.',
    ];
  }
  if (/caller does not have permission|PERMISSION_DENIED|The caller does not/i.test(message)) {
    return [
      `${sheetLabel} has not been shared with the service account.`,
      `Open the sheet → Share → paste ${email} → Viewer → Share.`,
    ];
  }
  if (/Requested entity was not found|404/i.test(message)) {
    return [
      `${sheetLabel} was not found — the spreadsheet ID is wrong.`,
      'Check the ID in the sheet URL between /d/ and /edit.',
    ];
  }
  if (/Unable to parse range/i.test(message)) {
    return [
      `The tab name is wrong for ${sheetLabel}.`,
      'Check the tab name at the bottom of the spreadsheet — it is case-sensitive.',
    ];
  }
  return ['Unrecognised error.', message];
}

async function probe(label, sheetId, tab, expectedColumns) {
  console.log(`\n3. ${label}`);
  try {
    const rows = await fetchSheetRows(sheetId, tab);
    ok(`Read ${rows.length} rows from "${tab}"`);

    if (rows.length === 0) {
      info('Sheet is empty or has only a header row.');
      return;
    }

    const columns = Object.keys(rows[0]).filter((c) => c !== 'row_number');
    const missing = expectedColumns.filter((c) => !columns.includes(c));

    if (missing.length > 0) {
      bad(`Missing expected column(s): ${missing.join(', ')}`);
      info(`Columns actually present: ${columns.join(', ')}`);
      failed = true;
    } else {
      ok(`All expected columns present (${columns.length} total)`);
    }
  } catch (error) {
    const [summary, fix] = explain(error.message, label);
    bad(summary);
    info(fix);
    failed = true;
  }
}

await probe('p1EmailStaging', STAGING_SHEET_ID, STAGING_TAB, [
  'Client', 'AttachmentName', 'Time', 'Processed', 'Completed', 'Issue Resolved', 'Category', 'Input Type',
]);

await probe('ticket_tracker_template', TICKETS_SHEET_ID, TICKETS_TAB, [
  'Row in Staging', 'Status', 'Created Date', 'Client', 'File Name', 'Error Type', 'Rerun',
]);

console.log(`\n${'─'.repeat(60)}`);
if (failed) {
  console.log('Not connected yet — see the fixes above.\n');
  process.exit(1);
}
console.log('Google Sheets is connected.\n');
console.log('Next:  npm run intake:fixture   # capture the golden test fixture');
console.log('       npm run test:intake      # verify against the example workbook\n');
