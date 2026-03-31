'use client';

import { useState, useRef } from 'react';
import type { MonthlyCoverage } from '@/types';

interface ProgressBarCellProps {
  coverage: MonthlyCoverage;
  onClick?: () => void;
  disabled?: boolean;
}

export default function ProgressBarCell({ coverage, onClick, disabled }: ProgressBarCellProps) {
  const { daysCovered, daysInMonth, percentage, gaps, effectiveDaysInMonth, isDeactivatedMonth } = coverage;
  const denom = effectiveDaysInMonth ?? daysInMonth;
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const getBgColor = () => {
    if (isDeactivatedMonth) return 'bg-slate-500 border-slate-600';
    if (percentage === 100) return 'bg-green-500 border-green-600';
    if (percentage >= 85) return 'bg-yellow-400 border-yellow-500';
    if (percentage >= 50) return 'bg-orange-500 border-orange-600';
    if (percentage > 0) return 'bg-red-500 border-red-600';
    return 'bg-gray-200 border-gray-300';
  };

  const getTextColor = () => {
    if (isDeactivatedMonth) return 'text-white';
    if (percentage === 0) return 'text-gray-500';
    return 'text-white';
  };
  
  const handleClick = () => {
    if (!disabled && onClick) {
      onClick();
    }
  };

  const handleMouseEnter = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setTooltipPos({
        x: rect.left + rect.width / 2,
        y: rect.bottom + 8
      });
    }
  };

  const handleMouseLeave = () => {
    setTooltipPos(null);
  };

  if (disabled) {
    return (
      <div className="h-7 bg-gray-100 border border-gray-200 rounded flex items-center justify-center">
        <span className="text-xs text-gray-400">—</span>
      </div>
    );
  }
  
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="focus:outline-none w-full"
        aria-label={`Add invoice for ${coverage.month}`}
      >
        <div className={`h-7 ${getBgColor()} border rounded flex items-center justify-center hover:brightness-110 hover:shadow-md transition-all cursor-pointer`}>
          <span className={`text-xs font-bold ${getTextColor()} drop-shadow-sm`}>
            {isDeactivatedMonth ? 'Off' : `${daysCovered}/${denom}`}
          </span>
        </div>
      </button>

      {/* Fixed position tooltip */}
      {tooltipPos && (
        <div 
          className="fixed z-[9999] bg-gray-900 text-white text-xs rounded px-3 py-2 shadow-xl pointer-events-none whitespace-nowrap"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="font-semibold">
            {isDeactivatedMonth
              ? 'Deactivated — no API data expected'
              : `${daysCovered}/${denom} days (${percentage.toFixed(1)}%)`}
          </div>
          {gaps && gaps.length > 0 && (
            <div className="text-gray-300 text-[11px] mt-0.5">{gaps.length} gap{gaps.length > 1 ? 's' : ''}</div>
          )}
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
        </div>
      )}
    </>
  );
}
