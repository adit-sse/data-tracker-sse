'use client';

import { getCoverageColorClass } from '@/lib/coverage';
import type { MonthlyCoverage } from '@/types';

interface ProgressBarCellProps {
  coverage: MonthlyCoverage;
}

export default function ProgressBarCell({ coverage }: ProgressBarCellProps) {
  const { daysCovered, daysInMonth, percentage, gaps } = coverage;
  const colors = getCoverageColorClass(percentage);
  
  return (
    <div className="group relative">
      {/* Progress bar container */}
      <div className="w-full bg-gray-200 rounded-full h-6 overflow-hidden">
        <div 
          className={`${colors.bg} h-full flex items-center justify-center text-xs font-medium text-white progress-bar-transition`}
          style={{ width: `${percentage}%` }}
        >
          {daysCovered > 0 && (
            <span className="px-1">{daysCovered}/{daysInMonth}</span>
          )}
        </div>
      </div>
      
      {/* Hover tooltip */}
      {gaps && gaps.length > 0 && (
        <div className="absolute z-10 invisible group-hover:visible bg-gray-900 text-white text-xs rounded p-2 mt-1 w-48 shadow-lg">
          <div className="font-semibold mb-1">Coverage Gaps:</div>
          {gaps.map((gap, idx) => (
            <div key={idx} className="text-xs">
              {gap.start} to {gap.end} ({gap.days} days)
            </div>
          ))}
        </div>
      )}
      
      {/* Show percentage text when no days covered */}
      {daysCovered === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
          0/{daysInMonth}
        </div>
      )}
    </div>
  );
}
