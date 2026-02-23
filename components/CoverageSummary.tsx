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
    const currentMonthLabel = format(today, 'MMM yy');
    
    let totalDaysCovered = 0;
    let totalPossibleDays = 0;
    let metersWithGaps = 0;
    let activeMeters = 0;

    metersWithCoverage.forEach(({ meter, coverage }) => {
      // Check if meter is currently active
      const todayStr = today.toISOString().split('T')[0];
      const isActive = !(
        (meter.in_service_end_date && meter.in_service_end_date <= todayStr) ||
        (meter.in_service_start_date && meter.in_service_start_date > todayStr)
      );
      
      if (isActive) {
        activeMeters++;
      }

      let meterHasGap = false;
      
      coverage.forEach((monthlyCoverage) => {
        const monthLabel = monthlyCoverage.month;
        // monthDate may be a string from JSON serialization
        const monthDate = typeof monthlyCoverage.monthDate === 'string' 
          ? new Date(monthlyCoverage.monthDate) 
          : monthlyCoverage.monthDate;
        
        // Only count months up to and including current month
        if (monthDate > today) {
          return;
        }

        // Check if this month is within the meter's service period
        const monthStart = format(monthDate, 'yyyy-MM-dd');
        const monthEnd = format(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0), 'yyyy-MM-dd');
        
        const beforeServiceStart = meter.in_service_start_date && monthEnd < meter.in_service_start_date;
        const afterServiceEnd = meter.in_service_end_date && monthStart > meter.in_service_end_date;
        
        // Skip months outside the meter's service period
        if (beforeServiceStart || afterServiceEnd) {
          return;
        }

        totalDaysCovered += monthlyCoverage.daysCovered;
        totalPossibleDays += monthlyCoverage.daysInMonth;
        
        if (monthlyCoverage.percentage < 100) {
          meterHasGap = true;
        }
      });

      if (meterHasGap) {
        metersWithGaps++;
      }
    });

    const overallCoverage = totalPossibleDays > 0 
      ? Math.round((totalDaysCovered / totalPossibleDays) * 100) 
      : 0;

    return {
      totalMeters: metersWithCoverage.length,
      activeMeters,
      overallCoverage,
      metersWithGaps,
      totalDaysCovered,
      totalPossibleDays
    };
  }, [metersWithCoverage]);

  if (metersWithCoverage.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {/* Overall Coverage */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="text-sm font-medium text-gray-500 mb-1">Overall Coverage</div>
        <div className="flex items-baseline gap-2">
          <span className={`text-3xl font-bold ${
            stats.overallCoverage >= 90 ? 'text-green-600' :
            stats.overallCoverage >= 70 ? 'text-yellow-600' :
            stats.overallCoverage >= 50 ? 'text-orange-600' :
            'text-red-600'
          }`}>
            {stats.overallCoverage}%
          </span>
          <span className="text-sm text-gray-400">to date</span>
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {stats.totalDaysCovered.toLocaleString()} / {stats.totalPossibleDays.toLocaleString()} days
        </div>
      </div>

      {/* Total Meters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="text-sm font-medium text-gray-500 mb-1">Total Meters</div>
        <div className="text-3xl font-bold text-gray-900">{stats.totalMeters}</div>
        <div className="text-xs text-gray-400 mt-1">
          {stats.activeMeters} active
        </div>
      </div>

      {/* Meters with Gaps */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="text-sm font-medium text-gray-500 mb-1">Meters with Gaps</div>
        <div className={`text-3xl font-bold ${stats.metersWithGaps > 0 ? 'text-red-600' : 'text-green-600'}`}>
          {stats.metersWithGaps}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {stats.metersWithGaps === 0 ? 'All meters fully covered' : 'need attention'}
        </div>
      </div>

      {/* Full Coverage */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="text-sm font-medium text-gray-500 mb-1">Fully Covered</div>
        <div className="text-3xl font-bold text-green-600">
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
