'use client';

import { useMemo } from 'react';
import { MeterWithCoverage } from '@/types';
import { format } from 'date-fns';

interface CoverageSummaryProps {
  metersWithCoverage: MeterWithCoverage[];
}

export default function CoverageSummary({ metersWithCoverage }: CoverageSummaryProps) {
  const stats = useMemo(() => {
    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const prevMonthEndStr = format(prevMonthEnd, 'yyyy-MM-dd');

    // Filter to only active meters (is_active flag takes precedence over service dates)
    const activeMetersData = metersWithCoverage.filter(({ meter }) => {
      const isInactive =
        meter.is_active === false ||
        (meter.in_service_end_date && meter.in_service_end_date <= todayStr) ||
        (meter.in_service_start_date && meter.in_service_start_date > todayStr);
      return !isInactive;
    });

    const totalMeters = activeMetersData.length;
    let totalDaysCovered = 0;
    let totalPossibleDays = 0;
    let metersComplete = 0;
    let metersWithGaps = 0;

    for (const { meter, coverage } of activeMetersData) {
      let meterHasGap = false;

      for (const mc of coverage) {
        const monthDate = mc.monthDate instanceof Date ? mc.monthDate : new Date(mc.monthDate);
        const monthStartStr = format(monthDate, 'yyyy-MM-dd');
        const monthEndDate = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
        const monthEndStr = format(monthEndDate, 'yyyy-MM-dd');

        // Only count completed past months (exclude current month)
        if (monthEndStr > prevMonthEndStr) continue;

        // Skip months before service start or after service end
        const beforeServiceStart = !!(meter.in_service_start_date && monthEndStr < meter.in_service_start_date);
        const afterServiceEnd = !!(meter.in_service_end_date && monthStartStr >= meter.in_service_end_date);
        if (beforeServiceStart || afterServiceEnd) continue;

        // Calculate active days in month (handle partial months)
        let activeDaysInMonth = mc.daysInMonth;
        if (meter.in_service_start_date && meter.in_service_start_date > monthStartStr && meter.in_service_start_date <= monthEndStr) {
          activeDaysInMonth -= new Date(meter.in_service_start_date).getDate() - 1;
        }
        if (meter.in_service_end_date && meter.in_service_end_date > monthStartStr && meter.in_service_end_date <= monthEndStr) {
          const endDay = new Date(meter.in_service_end_date).getDate();
          activeDaysInMonth -= monthEndDate.getDate() - endDay + 1;
        }

        if (mc.isDeactivatedMonth) {
          continue;
        }

        const calendarExpect = mc.effectiveDaysInMonth ?? mc.daysInMonth;
        const scale = mc.daysInMonth > 0 ? activeDaysInMonth / mc.daysInMonth : 1;
        const expectedApiDays = Math.max(0, Math.min(activeDaysInMonth, Math.round(calendarExpect * scale)));

        const effectiveCovered = Math.min(mc.daysCovered, expectedApiDays);
        totalDaysCovered += effectiveCovered;
        totalPossibleDays += expectedApiDays;

        if (effectiveCovered < expectedApiDays) {
          meterHasGap = true;
        }
      }

      if (meterHasGap) {
        metersWithGaps++;
      } else {
        metersComplete++;
      }
    }

    const overallCoverage = totalPossibleDays > 0
      ? Math.round((totalDaysCovered / totalPossibleDays) * 1000) / 10
      : 0;

    return {
      totalMeters,
      overallCoverage,
      totalDaysCovered,
      totalPossibleDays,
      metersComplete,
      metersWithGaps
    };
  }, [metersWithCoverage]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      {/* Active Meters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.totalMeters}</p>
            <p className="text-sm text-gray-500">Active Meters</p>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-2">currently in service</p>
      </div>

      {/* Overall Coverage */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.overallCoverage}%</p>
            <p className="text-sm text-gray-500">Overall Coverage</p>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-2">{stats.totalDaysCovered}/{stats.totalPossibleDays} days (excl. current month)</p>
      </div>

      {/* Complete */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.metersComplete}</p>
            <p className="text-sm text-gray-500">Complete</p>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-2">meters with full coverage</p>
      </div>

      {/* With Gaps */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.metersWithGaps}</p>
            <p className="text-sm text-gray-500">With Gaps</p>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-2">meters needing attention</p>
      </div>
    </div>
  );
}
