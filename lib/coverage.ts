import { 
  startOfMonth, 
  endOfMonth, 
  getDaysInMonth, 
  format, 
  isWithinInterval,
  eachDayOfInterval,
  parseISO,
  isSameDay,
  differenceInCalendarDays
} from 'date-fns';
import type { ActualInvoice, MonthlyCoverage, DateGap } from '@/types';

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

/**
 * Calculate coverage for a meter across all months in the fiscal year
 */
export function calculateMonthlyCoverage(
  invoices: ActualInvoice[], 
  fiscalYear: number
): MonthlyCoverage[] {
  const months = generateFiscalYearMonths(fiscalYear);
  
  return months.map(monthDate => {
    const monthStart = startOfMonth(monthDate);
    const monthEnd = endOfMonth(monthDate);
    const daysInMonth = getDaysInMonth(monthDate);
    
    // Set to store unique days covered in this month
    const coveredDays = new Set<string>();
    
    // For each invoice, add covered days in this month
    invoices.forEach(invoice => {
      const periodStart = parseISO(invoice.period_start_date);
      const periodEnd = parseISO(invoice.period_end_date);
      
      // Get all days in the invoice period that fall within this month
      const daysInPeriod = eachDayOfInterval({
        start: periodStart > monthStart ? periodStart : monthStart,
        end: periodEnd < monthEnd ? periodEnd : monthEnd
      });
      
      daysInPeriod.forEach(day => {
        if (isWithinInterval(day, { start: monthStart, end: monthEnd })) {
          coveredDays.add(format(day, 'yyyy-MM-dd'));
        }
      });
    });
    
    const daysCovered = coveredDays.size;
    const percentage = (daysCovered / daysInMonth) * 100;
    
    // Calculate gaps
    const gaps = findGaps(Array.from(coveredDays), monthStart, monthEnd);
    
    return {
      month: format(monthDate, 'MMM yy'),
      monthDate,
      daysInMonth,
      daysCovered,
      percentage,
      gaps: gaps.length > 0 ? gaps : undefined
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
    
    // Get days that overlap with current month
    const daysInPeriod = eachDayOfInterval({
      start: periodStart > monthStart ? periodStart : monthStart,
      end: periodEnd < monthEnd ? periodEnd : monthEnd
    });
    
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
    percentage: totalPossibleDays > 0 ? (daysCovered / totalPossibleDays) * 100 : 0
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
