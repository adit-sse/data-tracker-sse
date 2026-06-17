/**
 * lib/upload/parse.ts
 *
 * Turns a raw File (CSV or XLSX) into an array of normalised string-keyed rows.
 * No HTTP, no database — fully unit-testable with a File/Blob stub.
 */

import Papa from 'papaparse';
import * as XLSX from 'xlsx';

/** Strip BOM, trim whitespace from every key and value in a spreadsheet row. */
export function normalizeSpreadsheetRow(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = String(k).replace(/^\uFEFF/, '').trim();
    if (!key) continue;
    if (v === undefined || v === null) continue;
    const s = typeof v === 'string' ? v : String(v);
    out[key] = s.replace(/^\uFEFF/, '').trim();
  }
  return out;
}

export function parseCsvText(text: string): Record<string, string>[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0) {
    throw new Error(`Failed to parse CSV: ${result.errors[0].message}`);
  }

  return result.data.map((r) => normalizeSpreadsheetRow(r as Record<string, unknown>));
}

export function parseXlsxBuffer(buffer: ArrayBuffer): Record<string, string>[] {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { raw: false }) as Record<string, unknown>[];
  return rawRows.map((r) => normalizeSpreadsheetRow(r));
}

/**
 * Parse a CSV or XLSX File into normalised rows.
 * Throws on unsupported format, parse errors, or empty result.
 */
export async function parseUploadFile(file: File): Promise<Record<string, string>[]> {
  const name = file.name.toLowerCase();

  let rows: Record<string, string>[];

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buffer = await file.arrayBuffer();
    rows = parseXlsxBuffer(buffer);
  } else if (name.endsWith('.csv')) {
    const text = await file.text();
    rows = parseCsvText(text);
  } else {
    throw new Error('Invalid file format. Please upload a CSV or XLSX file.');
  }

  if (rows.length === 0) {
    throw new Error('File is empty or has no valid data rows.');
  }

  return rows;
}
