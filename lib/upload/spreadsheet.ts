/**
 * lib/upload/spreadsheet.ts
 *
 * Spreadsheet-quirk handling and upload-format detection.
 * Pure functions — no HTTP, no database.
 */

/**
 * Returns true when a row supplies its own MonthsDeactivated value.
 * Used during carry-down to prevent fuel "off" ranges bleeding into
 * unrelated utility rows below.
 */
export function rowHasOwnMonthsDeactivated(r: Record<string, string>): boolean {
  if (r.MonthsDeactivated?.trim()) return true;
  for (const [k, v] of Object.entries(r)) {
    if (k.replace(/^\uFEFF/, '').trim().toLowerCase() === 'monthsdeactivated' && String(v ?? '').trim()) {
      return true;
    }
  }
  return false;
}

/**
 * Detect whether the upload file is invoice format or meter-setup format
 * based on the header names of the first row.
 *
 * - "invoice"     → has both `Company` and `Date Range` columns
 * - "meter-setup" → has `Utility`, `MonthsWithData`, or `Input Type` (but not invoice headers)
 */
export function detectUploadFormat(headers: string[]): 'invoice' | 'meter-setup' {
  const looksLikeInvoice =
    headers.some((h) => h === 'Company') && headers.some((h) => h === 'Date Range');

  if (looksLikeInvoice) return 'invoice';

  return 'meter-setup';
}

/**
 * Excel merged cells leave MonthsWithData (and MonthsDeactivated) blank on
 * rows 2+. This carry-down replicates the "fill down" a user would see in
 * the spreadsheet, but intentionally does NOT carry MonthsDeactivated so
 * that fuel "off" ranges don't bleed into unrelated utility rows below.
 *
 * Mutates the rows array in-place (clones individual row objects).
 */
export function applyMeterSetupCarryDown(rows: Record<string, string>[]): void {
  let lastMonths = '';

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    // Resolve MonthsWithData — check canonical key then BOM-prefixed variants.
    let m = r.MonthsWithData?.trim() ?? '';
    if (!m) {
      for (const [k, v] of Object.entries(r)) {
        if (k.replace(/^\uFEFF/, '').trim().toLowerCase() === 'monthswithdata') {
          m = String(v ?? '').trim();
          break;
        }
      }
    }

    if (m) {
      lastMonths = m;
    } else if (lastMonths && !rowHasOwnMonthsDeactivated(r)) {
      m = lastMonths;
    }

    if (m) rows[i] = { ...r, MonthsWithData: m };

    // Resolve MonthsDeactivated on the (possibly updated) row — do not carry down.
    let md = rows[i].MonthsDeactivated?.trim() ?? '';
    if (!md) {
      for (const [k, v] of Object.entries(rows[i])) {
        if (k.replace(/^\uFEFF/, '').trim().toLowerCase() === 'monthsdeactivated') {
          md = String(v ?? '').trim();
          break;
        }
      }
    }
    if (md) rows[i] = { ...rows[i], MonthsDeactivated: md };
  }
}
