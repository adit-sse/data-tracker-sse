import { 
  startOfMonth, 
  endOfMonth, 
  getDaysInMonth, 
  format, 
  isWithinInterval,
  eachDayOfInterval,
  parseISO,
  isSameDay,
  differenceInCalendarDays,
  isValid
} from 'date-fns';
import type { ActualInvoice, MeterMonthSlot, MonthlyCoverage, DateGap } from '@/types';

/**
 * Generate 12 months for a fiscal year (July to June)
 */
export function generateFiscalYearMonths(fiscalYear: number): Date[] {
  const months: Date[] = [];
  
  // Fiscal year starts in July of previous calendar year
  // FY2025 = July 2024 to June 2025
  const startYear = fiscalYear - 1;
  
  for (let i = 0; i < 12; i++) {
    const monthIndex = (6 + i) % 12; // Start from July (month 6)
    const year = i < 6 ? startYear : fiscalYear;
    months.push(new Date(year, monthIndex, 1));
  }
  
  return months;
}

function isDeactivatedInvoiceStatus(status: string | null | undefined): boolean {
  return (status || '').trim().toUpperCase() === 'DEACTIVATED';
}

function isPendingOrErrorInvoiceStatus(status: string | null | undefined): boolean {
  const s = (status || '').trim().toUpperCase();
  return s === 'PENDING' || s === 'ERROR';
}

/**
 * Calculate coverage for a meter across all months in the fiscal year.
 * Invoices with status DEACTIVATED count as "no API data expected" for those days, not as gaps.
 * When slots are provided, hasPending and isDeactivatedMonth are derived from the slot status
 * rather than from PENDING/DEACTIVATED rows in actual_invoices.
 */
export function calculateMonthlyCoverage(
  invoices: ActualInvoice[],
  fiscalYear: number,
  slots?: MeterMonthSlot[]
): MonthlyCoverage[] {
  const months = generateFiscalYearMonths(fiscalYear);

  const slotsByMonth = slots
    ? new Map(slots.map((s) => [s.month_start, s]))
    : null;

  return months.map(monthDate => {
    const monthStart = startOfMonth(monthDate);
    const monthEnd = endOfMonth(monthDate);
    const daysInMonth = getDaysInMonth(monthDate);
    const monthKey = format(monthStart, 'yyyy-MM-dd');
    const slot = slotsByMonth?.get(monthKey) ?? null;
    
    /** Per calendar day: active invoice data wins over deactivated-only. */
    const dayState = new Map<string, 'active' | 'deactivated'>();
    const monthlyInvoices: ActualInvoice[] = [];

    invoices.forEach(invoice => {
      const periodStart = parseISO(invoice.period_start_date);
      const periodEnd = parseISO(invoice.period_end_date);

      if (!isValid(periodStart) || !isValid(periodEnd)) {
        console.warn('Skipping invoice with invalid dates', invoice.id, invoice.period_start_date, invoice.period_end_date);
        return;
      }

      const start = periodStart > monthStart ? periodStart : monthStart;
      const end = periodEnd < monthEnd ? periodEnd : monthEnd;

      if (start > end) {
        return;
      }

      monthlyInvoices.push(invoice);

      if (isPendingOrErrorInvoiceStatus(invoice.status)) {
        return;
      }

      const daysInPeriod = eachDayOfInterval({ start, end });
      const invDeactivated = isDeactivatedInvoiceStatus(invoice.status);

      daysInPeriod.forEach(day => {
        if (!isWithinInterval(day, { start: monthStart, end: monthEnd })) return;
        const key = format(day, 'yyyy-MM-dd');
        if (invDeactivated) {
          if (dayState.get(key) !== 'active') dayState.set(key, 'deactivated');
        } else {
          dayState.set(key, 'active');
        }
      });
    });

    let daysCovered = 0;
    let daysDeactivated = 0;
    for (const st of Array.from(dayState.values())) {
      if (st === 'active') daysCovered++;
      else daysDeactivated++;
    }

    const effectiveDaysInMonth = daysInMonth - daysDeactivated;
    const isDeactivatedMonth = daysDeactivated === daysInMonth && daysCovered === 0;
    const percentage =
      effectiveDaysInMonth > 0
        ? Math.round((daysCovered / effectiveDaysInMonth) * 1000) / 10
        : 0;

    const resolvedForGaps = Array.from(dayState.keys());
    const gaps = findGaps(resolvedForGaps, monthStart, monthEnd);

    // Prefer slot-based state when available; fall back to segment-derived for backward compat.
    const hasPending = slot
      ? slot.status === 'PENDING' || slot.status === 'ERROR'
      : monthlyInvoices.some(inv => (inv.status || '').trim().toUpperCase() === 'PENDING');

    const resolvedIsDeactivatedMonth = slot
      ? slot.status === 'DEACTIVATED'
      : isDeactivatedMonth;

    return {
      month: format(monthDate, 'MMM yy'),
      monthDate,
      daysInMonth,
      daysCovered,
      percentage,
      daysDeactivated: daysDeactivated > 0 ? daysDeactivated : undefined,
      isDeactivatedMonth: resolvedIsDeactivatedMonth || undefined,
      effectiveDaysInMonth: daysDeactivated > 0 ? effectiveDaysInMonth : undefined,
      hasPending: hasPending || undefined,
      gaps: gaps.length > 0 ? gaps : undefined,
      invoices: monthlyInvoices.length > 0 ? monthlyInvoices : undefined
    };
  });
}

/**
 * Find gaps in coverage for a month
 */
function findGaps(
  coveredDays: string[], 
  monthStart: Date, 
  monthEnd: Date
): DateGap[] {
  const allDaysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const coveredSet = new Set(coveredDays);
  const gaps: DateGap[] = [];
  let gapStart: Date | null = null;
  
  allDaysInMonth.forEach(day => {
    const dayStr = format(day, 'yyyy-MM-dd');
    const isCovered = coveredSet.has(dayStr);
    
    if (!isCovered && !gapStart) {
      // Start of a new gap
      gapStart = day;
    } else if (isCovered && gapStart) {
      // End of current gap
      const gapEnd = new Date(day.getTime() - 86400000); // Previous day
      gaps.push({
        start: format(gapStart, 'dd/MM/yyyy'),
        end: format(gapEnd, 'dd/MM/yyyy'),
        days: differenceInCalendarDays(gapEnd, gapStart) + 1
      });
      gapStart = null;
    }
  });
  
  // Handle gap extending to end of month
  if (gapStart) {
    gaps.push({
      start: format(gapStart, 'dd/MM/yyyy'),
      end: format(monthEnd, 'dd/MM/yyyy'),
      days: differenceInCalendarDays(monthEnd, gapStart) + 1
    });
  }
  
  return gaps;
}

/**
 * Calculate current month coverage for a client (used on home page)
 */
export function calculateCurrentMonthCoverageForClient(
  allInvoices: ActualInvoice[],
  meterCount: number
): {
  month: string;
  daysCovered: number;
  totalPossibleDays: number;
  percentage: number;
} {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const daysInMonth = getDaysInMonth(now);
  
  // Track coverage per meter: "meter_id:date"
  const coveredDaysByMeter = new Set<string>();
  
  allInvoices.forEach(invoice => {
    const periodStart = parseISO(invoice.period_start_date);
    const periodEnd = parseISO(invoice.period_end_date);
    
    // Validate invoice dates
    if (!isValid(periodStart) || !isValid(periodEnd)) {
      console.warn('Skipping invoice with invalid dates for current-month calc', invoice.id, invoice.period_start_date, invoice.period_end_date);
      return;
    }

    // Compute overlap with current month
    const start = periodStart > monthStart ? periodStart : monthStart;
    const end = periodEnd < monthEnd ? periodEnd : monthEnd;

    if (start > end) {
      // No overlap with current month
      return;
    }

    // Get days that overlap with current month
    const daysInPeriod = eachDayOfInterval({ start, end });
    
    daysInPeriod.forEach(day => {
      if (isWithinInterval(day, { start: monthStart, end: monthEnd })) {
        const key = `${invoice.meter_id}:${format(day, 'yyyy-MM-dd')}`;
        coveredDaysByMeter.add(key);
      }
    });
  });
  
  const totalPossibleDays = meterCount * daysInMonth;
  const daysCovered = coveredDaysByMeter.size;
  
  return {
    month: format(now, 'MMM yyyy'),
    daysCovered,
    totalPossibleDays,
    percentage: totalPossibleDays > 0 ? Math.round((daysCovered / totalPossibleDays) * 1000) / 10 : 0
  };
}

/**
 * Get color class based on coverage percentage
 */
export function getCoverageColor(percentage: number): string {
  if (percentage === 0) return 'coverage-none';
  if (percentage < 50) return 'coverage-low';
  if (percentage < 85) return 'coverage-medium';
  if (percentage < 100) return 'coverage-high';
  return 'coverage-full';
}

/**
 * Get color for Tailwind classes
 */
export function getCoverageColorClass(percentage: number): {
  bg: string;
  text: string;
} {
  if (percentage === 0) return { bg: 'bg-gray-400', text: 'text-gray-600' };
  if (percentage < 50) return { bg: 'bg-red-500', text: 'text-red-600' };
  if (percentage < 85) return { bg: 'bg-orange-500', text: 'text-orange-600' };
  if (percentage < 100) return { bg: 'bg-yellow-500', text: 'text-yellow-600' };
  return { bg: 'bg-green-500', text: 'text-green-600' };
}

/**
 * Parse date range string from CSV (e.g., "01/12/2025-31/12/2025")
 */
export function parseDateRange(dateRange: string): {
  startDate: string;
  endDate: string;
} | null {
  try {
    const parts = dateRange.split('-');
    if (parts.length !== 2) return null;
    
    const startParts = parts[0].trim().split('/');
    const endParts = parts[1].trim().split('/');
    
    if (startParts.length !== 3 || endParts.length !== 3) return null;
    
    // Convert DD/MM/YYYY to YYYY-MM-DD
    const startDate = `${startParts[2]}-${startParts[1].padStart(2, '0')}-${startParts[0].padStart(2, '0')}`;
    const endDate = `${endParts[2]}-${endParts[1].padStart(2, '0')}-${endParts[0].padStart(2, '0')}`;
    
    return { startDate, endDate };
  } catch (error) {
    return null;
  }
}
