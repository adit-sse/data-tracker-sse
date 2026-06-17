/**
 * lib/upload/month-ranges.ts
 *
 * Parses MonthsWithData / MonthsDeactivated cell values into arrays of ISO
 * date-range objects, and expands those ranges into per-month periods.
 *
 * Supported input format (semicolon-separated segments):
 *   "Jul 2025"                        → single month
 *   "Jul 2025 - Nov 2025"             → range
 *   "Jul 2025 - Nov 2025; Jan 2026"   → two segments (Dec 2025 is a gap)
 *   "July 2025 - June 2026"           → full month names accepted
 *
 * Note: the invoice upload uses "DD/MM/YYYY - DD/MM/YYYY" date ranges handled
 * by lib/coverage.ts (parseDateRange). This module handles the separate
 * "Mon YYYY" format used in the meter-setup spreadsheet template.
 */

import { parse, isValid } from 'date-fns';

function normalizeMonthYearToken(str: string): string {
  const trimmed = str.trim().replace(/\s+/g, ' ');
  const m = trimmed.match(/^(.+?)\s+(\d{4})$/);
  if (!m) return trimmed;
  const [, name, year] = m;
  const titled =
    name.length <= 3
      ? name.slice(0, 1).toUpperCase() + name.slice(1).toLowerCase()
      : name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  return `${titled} ${year}`;
}

function parseMonthYear(str: string): { month: number; year: number } | null {
  const normalized = normalizeMonthYearToken(str);
  if (!normalized) return null;
  const ref = new Date(2000, 0, 1);
  let d = parse(normalized, 'MMM yyyy', ref);
  if (!isValid(d)) d = parse(normalized, 'MMMM yyyy', ref);
  if (!isValid(d)) return null;
  return { month: d.getMonth(), year: d.getFullYear() };
}

function monthYearToDates(my: { month: number; year: number }): { startDate: string; endDate: string } {
  const startDate = `${my.year}-${String(my.month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(my.year, my.month + 1, 0).getDate();
  const endDate = `${my.year}-${String(my.month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
}

/** Parse one segment: either "Mon YYYY" or "Mon YYYY - Mon YYYY". */
function parseOneSegment(segment: string): { startDate: string; endDate: string } | null {
  // Normalise en/em/minus dashes so splitting works uniformly.
  const normalised = segment.replace(/\u2013|\u2014|\u2212/g, '-').trim();

  const parts = normalised.split('-').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 2) {
    const start = parseMonthYear(parts[0]);
    const end = parseMonthYear(parts[1]);
    if (start && end) {
      return {
        startDate: monthYearToDates(start).startDate,
        endDate: monthYearToDates(end).endDate,
      };
    }
  }

  const single = parseMonthYear(normalised);
  if (single) return monthYearToDates(single);

  return null;
}

/**
 * Parse a MonthsWithData / MonthsDeactivated string into date ranges.
 * Returns null when the string is empty or any segment is unparseable.
 */
export function parseMonthRanges(input: string): Array<{ startDate: string; endDate: string }> | null {
  if (!input?.trim()) return null;
  const segments = input.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  const ranges: Array<{ startDate: string; endDate: string }> = [];
  for (const segment of segments) {
    const range = parseOneSegment(segment);
    if (!range) return null;
    ranges.push(range);
  }
  return ranges;
}

/**
 * Expand an ISO date range into an array of calendar-month periods.
 * Each period has `start` (first day of month) and `end` (last day of month).
 */
export function generateMonthlyPeriods(
  startDate: string,
  endDate: string,
): Array<{ start: string; end: string }> {
  const periods: Array<{ start: string; end: string }> = [];
  const end = new Date(endDate);
  let current = new Date(startDate);
  current = new Date(current.getFullYear(), current.getMonth(), 1);

  while (current <= end) {
    const y = current.getFullYear();
    const mo = current.getMonth();
    const monthStart = `${y}-${String(mo + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(y, mo + 1, 0).getDate();
    const monthEnd = `${y}-${String(mo + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    periods.push({ start: monthStart, end: monthEnd });
    current = new Date(y, mo + 1, 1);
  }

  return periods;
}
