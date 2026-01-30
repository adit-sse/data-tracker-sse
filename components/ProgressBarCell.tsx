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
      {/* Progress bar container (wider, not taller) */}
      <div className="mx-auto bg-gray-200 rounded-full h-8 overflow-hidden relative min-w-[60px] md:min-w-[60px]">
        <div
          className={`${colors.bg} absolute left-0 top-0 h-full progress-bar-transition ${percentage >= 100 ? 'rounded-full' : 'rounded-l-full'}`}
          style={{ width: `${Math.max(0.5, Math.min(percentage, 100))}%` }}
        />
      </div>

      {/* Centered overlay text */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 group-hover:opacity-0 transition-opacity duration-150">
        <span className={`${percentage >= 50 ? 'text-white' : 'text-gray-600'} text-sm font-semibold`}>
          {daysCovered}/{daysInMonth}
        </span>
      </div>

      {/* Hover tooltip */}
      {gaps && gaps.length > 0 && (
        <div className="absolute z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-gray-900 text-white text-xs rounded p-2 mt-1 w-48 shadow-lg">
          <div className="font-semibold mb-1">Coverage Gaps:</div>
          {gaps.map((gap, idx) => (
            <div key={idx} className="text-xs">
              {gap.start} to {gap.end} ({gap.days} days)
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
