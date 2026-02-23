'use client';

import { useMemo } from 'react';
import { format } from 'date-fns';
import type { MeterWithCoverage } from '@/types';

interface CoverageSummaryProps {
  metersWithCoverage: MeterWithCoverage[];
}

export default function CoverageSummary({ metersWithCoverage }: CoverageSummaryProps) {
  const stats = useMemo(() => {
    if (metersWithCoverage.length === 0) {
      return {
        totalMeters: 0,
        activeMeters: 0,
        overallCoverage: 0,
        metersWithGaps: 0,
        totalDaysCovered: 0,
        totalPossibleDays: 0
      };
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // Filter to only include active meters
    const activeMetersData = metersWithCoverage.filter(({ meter }) => {
      const isInactive = 
        (meter.in_service_end_date && meter.in_service_end_date <= todayStr) ||
        (meter.in_service_start_date && meter.in_service_start_date > todayStr);
      return !isInactive;
    });
    
    let totalDaysCovered = 0;
    let totalPossibleDays = 0;
    let metersWithGaps = 0;
    const activeMeters = activeMetersData.length;

    activeMetersData.forEach(({ meter, coverage }) => {
      let meterHasGap = false;
      
      coverage.forEach((monthlyCoverage) => {
        const monthDate = typeof monthlyCoverage.monthDate === 'string' 
          ? new Date(monthlyCoverage.monthDate) 
          : monthlyCoverage.monthDate;
        
        if (monthDate > today) {
          return;
        }

        const monthStartStr = format(monthDate, 'yyyy-MM-dd');
        const monthEndDate = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
        const monthEndStr = format(monthEndDate, 'yyyy-MM-dd');
        
        const beforeServiceStart = meter.in_service_start_date && monthEndStr < meter.in_service_start_date;
        const afterServiceEnd = meter.in_service_end_date && monthStartStr >= meter.in_service_end_date;
        
        if (beforeServiceStart || afterServiceEnd) {
          return;
        }

        // Calculate actual days the meter should be active this month (for partial months)
        let activeDaysInMonth = monthlyCoverage.daysInMonth;
        
        // If meter started mid-month, reduce expected days
        if (meter.in_service_start_date && meter.in_service_start_date > monthStartStr && meter.in_service_start_date <= monthEndStr) {
          const serviceStartDate = new Date(meter.in_service_start_date);
          const daysBeforeStart = serviceStartDate.getDate() - 1;
          activeDaysInMonth -= daysBeforeStart;
        }
        
        // If meter ended mid-month, reduce expected days
        if (meter.in_service_end_date && meter.in_service_end_date > monthStartStr && meter.in_service_end_date <= monthEndStr) {
          const serviceEndDate = new Date(meter.in_service_end_date);
          const daysAfterEnd = monthEndDate.getDate() - serviceEndDate.getDate() + 1;
          activeDaysInMonth -= daysAfterEnd;
        }
        
        // Clamp coverage to active days (in case invoices cover more than active period)
        const effectiveCoveredDays = Math.min(monthlyCoverage.daysCovered, activeDaysInMonth);
        
        totalDaysCovered += effectiveCoveredDays;
        totalPossibleDays += activeDaysInMonth;
        
        // Check for gaps only considering active days
        if (activeDaysInMonth > 0 && effectiveCoveredDays < activeDaysInMonth) {
          meterHasGap = true;
        }
      });

      if (meterHasGap) {
        metersWithGaps++;
      }
    });

    const overallCoverage = totalPossibleDays > 0 
      ? Math.round((totalDaysCovered / totalPossibleDays) * 1000) / 10
      : 0;

    return {
      totalMeters: activeMeters,
      overallCoverage,
      metersWithGaps,
      totalDaysCovered,
      totalPossibleDays
    };
  }, [metersWithCoverage]);

  if (metersWithCoverage.length === 0 || stats.totalMeters === 0) {
    return null;
  }

  const getCoverageColor = (percentage: number) => {
    if (percentage >= 90) return { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-500/20' };
    if (percentage >= 70) return { bg: 'bg-amber-50', text: 'text-amber-600', ring: 'ring-amber-500/20' };
    if (percentage >= 50) return { bg: 'bg-orange-50', text: 'text-orange-600', ring: 'ring-orange-500/20' };
    return { bg: 'bg-red-50', text: 'text-red-600', ring: 'ring-red-500/20' };
  };

  const coverageColor = getCoverageColor(stats.overallCoverage);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {/* Overall Coverage */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-8 h-8 rounded-lg ${coverageColor.bg} flex items-center justify-center`}>
            <svg className={`w-4 h-4 ${coverageColor.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <span className="text-sm font-medium text-gray-500">Coverage</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className={`text-3xl font-bold ${coverageColor.text}`}>
            {stats.overallCoverage}%
          </span>
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {stats.totalDaysCovered.toLocaleString()} / {stats.totalPossibleDays.toLocaleString()} days
        </div>
      </div>

      {/* Active Meters */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="text-sm font-medium text-gray-500">Active Meters</span>
        </div>
        <div className="text-3xl font-bold text-gray-900">{stats.totalMeters}</div>
        <div className="text-xs text-gray-400 mt-1">
          currently in service
        </div>
      </div>

      {/* Meters with Gaps */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-8 h-8 rounded-lg ${stats.metersWithGaps > 0 ? 'bg-red-50' : 'bg-emerald-50'} flex items-center justify-center`}>
            <svg className={`w-4 h-4 ${stats.metersWithGaps > 0 ? 'text-red-600' : 'text-emerald-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <span className="text-sm font-medium text-gray-500">With Gaps</span>
        </div>
        <div className={`text-3xl font-bold ${stats.metersWithGaps > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
          {stats.metersWithGaps}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {stats.metersWithGaps === 0 ? 'All covered' : 'need attention'}
        </div>
      </div>

      {/* Fully Covered */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="text-sm font-medium text-gray-500">Complete</span>
        </div>
        <div className="text-3xl font-bold text-emerald-600">
          {stats.totalMeters - stats.metersWithGaps}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {stats.totalMeters > 0 
            ? `${Math.round(((stats.totalMeters - stats.metersWithGaps) / stats.totalMeters) * 100)}% of meters`
            : '0% of meters'
          }
        </div>
      </div>
    </div>
  );
}
