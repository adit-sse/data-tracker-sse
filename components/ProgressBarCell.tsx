'use client';

import { getCoverageColorClass } from '@/lib/coverage';
import type { MonthlyCoverage } from '@/types';

interface ProgressBarCellProps {
  coverage: MonthlyCoverage;
  onClick?: () => void;
  disabled?: boolean;
}

export default function ProgressBarCell({ coverage, onClick, disabled }: ProgressBarCellProps) {
  const { daysCovered, daysInMonth, percentage, gaps } = coverage;
  const colors = getCoverageColorClass(percentage);
  
  const handleClick = () => {
    if (!disabled && onClick) {
      onClick();
    }
  };
  
  if (disabled) {
    return (
      <div className="group relative cursor-not-allowed opacity-40">
        <div className="mx-auto bg-gray-200 rounded-full h-8 overflow-hidden relative min-w-[60px] md:min-w-[60px]">
          <div
            className={`${colors.bg} absolute left-0 top-0 h-full ${percentage >= 100 ? 'rounded-full' : 'rounded-l-full'}`}
            style={{ width: `${Math.max(0.5, Math.min(percentage, 100))}%` }}
          />
        </div>
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <span className={`${percentage >= 50 ? 'text-white' : 'text-gray-600'} text-sm font-semibold`}>
            {daysCovered}/{daysInMonth}
          </span>
        </div>
      </div>
    );
  }
  
  return (
    <button
      type="button"
      onClick={handleClick}
      className="group relative focus:outline-none"
      aria-label={`Add invoice for ${coverage.month}`}
    >
      {/* Progress bar container (wider, not taller) */}
      <div className="mx-auto bg-gray-200 rounded-full h-8 overflow-hidden relative min-w-[60px] md:min-w-[60px] cursor-pointer">
        <div
          className={`${colors.bg} absolute left-0 top-0 h-full progress-bar-transition ${percentage >= 100 ? 'rounded-full' : 'rounded-l-full'}`}
          style={{ width: `${Math.max(0.5, Math.min(percentage, 100))}%` }}
        />
      </div>

      {/* Centered overlay text */}
      <div className="absolute inset-0 flex items-center justify-center z-20 transition-opacity duration-150 group-hover:opacity-60">
        <span className={`${percentage >= 50 ? 'text-white' : 'text-gray-600'} text-sm font-semibold`}>
          {daysCovered}/{daysInMonth}
        </span>
      </div>

      {/* Hover tooltip */}
      {gaps && gaps.length > 0 && (
        <div className="absolute z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none group-hover:pointer-events-auto bg-gray-900 text-white text-xs rounded p-2 mt-1 w-48 shadow-lg">
          <div className="font-semibold mb-1">Coverage Gaps:</div>
          {gaps.map((gap, idx) => (
            <div key={idx} className="text-xs">
              {gap.start} to {gap.end} ({gap.days} days)
            </div>
          ))}
        </div>
      )}
    </button>
  );
}
