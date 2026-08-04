/**
 * Regenerates lib/canonical/data.ts from the operations team's emailMapping
 * workbook.
 *
 *   node scripts/build-canonical-data.mjs "C:/Users/mahes/Documents/EC Data Exports/emailMapping.xlsx"
 *
 * The workbook lives outside the repo (it is maintained by hand alongside the
 * mailbox rules), so the extracted names are committed instead of read at
 * runtime. Re-run this whenever a client or supplier is added to the workbook.
 *
 * Sheets consumed:
 *   Client   — email, client, domain   → canonical client names
 *   Supplier — Email, Supplier         → canonical supplier names + sender domains
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'lib', 'canonical', 'data.ts');

const workbookPath = process.argv[2];
if (!workbookPath) {
  console.error('Usage: node scripts/build-canonical-data.mjs <path to emailMapping.xlsx>');
  process.exit(1);
}

const wb = XLSX.readFile(workbookPath);

function sheet(name) {
  if (!wb.Sheets[name]) throw new Error(`Sheet "${name}" not found in ${workbookPath}`);
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { raw: false });
}

/** Trim and collapse internal whitespace; the workbook has trailing spaces. */
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// --- Clients -------------------------------------------------------------
const clients = new Set();
for (const row of sheet('Client')) {
  const name = clean(row.client);
  if (name) clients.add(name);
}

// --- Suppliers + sender domains -----------------------------------------
const suppliers = new Set();
/** domain (lowercase) → canonical supplier name */
const domains = new Map();

for (const row of sheet('Supplier')) {
  const name = clean(row.Supplier);
  if (!name) continue;
  suppliers.add(name);

  const email = clean(row.Email).toLowerCase();
  if (!email) continue;
  // Entries are either a bare domain ("agl.com.au") or a full address
  // ("meterdatarequests@agl.com.au"); keep the domain part either way.
  const domain = email.includes('@') ? email.slice(email.lastIndexOf('@') + 1) : email;
  if (domain.includes('.')) domains.set(domain, name);
}

// The workbook has near-duplicate spellings ("Origin" / "Origin ") that clean()
// already folds together, plus genuine variants that must be resolved by hand.
// Report anything that normalises to the same key so it can be fixed at source.
const collision = new Map();
for (const name of suppliers) {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!collision.has(key)) collision.set(key, []);
  collision.get(key).push(name);
}
for (const [, names] of collision) {
  if (names.length > 1) {
    console.warn(`warning: supplier spellings differ only by case/punctuation: ${names.join(' | ')}`);
  }
}

const sortedClients = [...clients].sort((a, b) => a.localeCompare(b));
const sortedSuppliers = [...suppliers].sort((a, b) => a.localeCompare(b));
const sortedDomains = [...domains.entries()].sort((a, b) => a[0].localeCompare(b[0]));

const list = (items) => items.map((v) => `  ${JSON.stringify(v)},`).join('\n');
const entries = (pairs) => pairs.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');

const banner = `/**
 * lib/canonical/data.ts
 *
 * GENERATED FILE — do not edit by hand.
 * Regenerate with:
 *   node scripts/build-canonical-data.mjs <path to emailMapping.xlsx>
 *
 * Source: emailMapping.xlsx (Client and Supplier sheets), the mapping the
 * operations mailbox already uses to attribute inbound email. Standardising
 * uploads against the same list keeps the tracker and the mailbox in step.
 */
`;

const body = `${banner}
/** Canonical client names (${sortedClients.length}). */
export const CANONICAL_CLIENTS: readonly string[] = [
${list(sortedClients)}
];

/** Canonical supplier names (${sortedSuppliers.length}). */
export const CANONICAL_SUPPLIERS: readonly string[] = [
${list(sortedSuppliers)}
];

/** Sender email domain → canonical supplier name (${sortedDomains.length}). */
export const SUPPLIER_DOMAINS: Readonly<Record<string, string>> = {
${entries(sortedDomains)}
};
`;

writeFileSync(OUT, body, 'utf8');
console.log(
  `wrote ${OUT}\n  clients:   ${sortedClients.length}\n  suppliers: ${sortedSuppliers.length}\n  domains:   ${sortedDomains.length}`,
);
