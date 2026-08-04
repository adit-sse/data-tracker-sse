/**
 * Minimal read-only Google Sheets client, authenticated as a service account.
 *
 * Hand-rolled rather than using `googleapis`, which is a very large dependency
 * for what amounts to two GET requests. The only non-obvious part is signing the
 * JWT, and Node's built-in crypto does that in a few lines.
 *
 * Server-only. The private key must never reach the browser, so nothing here
 * may be imported from a client component.
 */

import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/** Refresh slightly early so a token can't expire mid-request. */
const EXPIRY_SKEW_MS = 60_000;

export interface SheetsConfig {
  clientEmail: string;
  privateKey: string;
}

/**
 * Reads the service account credentials, or null when they aren't configured.
 *
 * Returning null rather than throwing is deliberate: the dashboard ships before
 * the credentials do, and a missing key should render setup copy, not a 500.
 */
export function getSheetsConfig(): SheetsConfig | null {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const rawKey = process.env.GOOGLE_PRIVATE_KEY?.trim();
  if (!clientEmail || !rawKey) return null;

  return {
    clientEmail,
    // Env files store the PEM on one line with literal backslash-n. Without
    // this the key fails to parse with an opaque DECODER error.
    privateKey: rawKey.replace(/\\n/g, '\n'),
  };
}

export function isSheetsConfigured(): boolean {
  return getSheetsConfig() !== null;
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Exchanges a signed JWT for an access token, reusing the previous one until it
 * is nearly expired.
 */
async function getAccessToken(config: SheetsConfig): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - EXPIRY_SKEW_MS) {
    return cachedToken.value;
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = base64Url(signer.sign(config.privateKey));
  const assertion = `${header}.${claims}.${signature}`;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google token request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error('Google token response contained no access_token');
  }

  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

export type SheetRow = Record<string, string> & { row_number: number };

/**
 * Reads a whole tab and maps the header row onto the rows beneath it.
 *
 * `row_number` is the 1-based sheet row, which is what both the ticket tracker
 * and the example workbook use to identify a file. It is the only stable
 * identity a row has, so it is injected here rather than derived later.
 */
export async function fetchSheetRows(
  spreadsheetId: string,
  tabName: string,
): Promise<SheetRow[]> {
  const config = getSheetsConfig();
  if (!config) {
    throw new Error('Google Sheets credentials are not configured');
  }

  const token = await getAccessToken(config);
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(tabName)}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Google Sheets read failed for "${tabName}" (${response.status}): ${body.slice(0, 300)}`,
    );
  }

  const json = (await response.json()) as { values?: string[][] };
  const values = json.values ?? [];
  if (values.length < 2) return [];

  const headers = values[0].map((h) => (h ?? '').trim());

  return values.slice(1).map((cells, index) => {
    const row = { row_number: index + 2 } as SheetRow;
    headers.forEach((header, column) => {
      if (!header) return;
      // Google truncates trailing empty cells, so a row ending in blanks comes
      // back short. Defaulting to '' keeps every column present — otherwise the
      // sparsely-filled columns (Rerun, Issue Resolved) would be undefined on
      // exactly the rows that matter.
      row[header] = (cells[column] ?? '').trim();
    });
    return row;
  });
}

/**
 * Small TTL cache over `fetchSheetRows`.
 *
 * The raw rows are cached rather than any summarised result, so paging back
 * through weeks in the UI costs no further API calls.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

const rowCache = new Map<string, { rows: SheetRow[]; fetchedAt: number }>();

export async function fetchSheetRowsCached(
  spreadsheetId: string,
  tabName: string,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<SheetRow[]> {
  const key = `${spreadsheetId}::${tabName}`;
  const hit = rowCache.get(key);

  if (!refresh && hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.rows;
  }

  const rows = await fetchSheetRows(spreadsheetId, tabName);
  rowCache.set(key, { rows, fetchedAt: Date.now() });
  return rows;
}
