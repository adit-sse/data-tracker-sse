'use client';

import { useState, useRef } from 'react';
import { format } from 'date-fns';
import type { NonMeteredRowWithCoverage, NonMeteredMonthlyCoverage, NonMeteredRecord } from '@/types';

interface NonMeteredCoverageTableProps {
  rows: NonMeteredRowWithCoverage[];
  fiscalYear: number;
  onCellClick?: (record: NonMeteredRecord) => void;
  onEmptyCellClick?: (row: NonMeteredRowWithCoverage, cell: NonMeteredMonthlyCoverage) => void;
}

export default function NonMeteredCoverageTable({
  rows,
  fiscalYear,
  onCellClick,
  onEmptyCellClick,
}: NonMeteredCoverageTableProps) {
  const [filterSupplier, setFilterSupplier] = useState<string>('ALL');
  const [filterFacility, setFilterFacility] = useState<string>('ALL');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');

  const suppliers = Array.from(new Set(rows.map((r) => r.supplierName))).sort();
  const facilityNames = Array.from(new Set(rows.map((r) => r.facilityName))).sort();
  const categories = Array.from(new Set(rows.map((r) => r.categoryName))).sort();

  const filteredRows = rows.filter((r) => {
    const s = filterSupplier === 'ALL' || r.supplierName === filterSupplier;
    const f = filterFacility === 'ALL' || r.facilityName === filterFacility;
    const c = filterCategory === 'ALL' || r.categoryName === filterCategory;
    return s && f && c;
  });

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
        <p className="text-gray-500">
          No non-metered records found. Upload NGERS data to see coverage.
        </p>
      </div>
    );
  }

  const monthLabels = rows[0]?.coverage.map((c) => c.month) || [];
  const now = new Date();
  const currentMonthLabel = format(now, 'MMM yy');

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Filter Controls */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Filters:
          </span>

          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            <option value="ALL">All Types</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            value={filterSupplier}
            onChange={(e) => setFilterSupplier(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            <option value="ALL">All Suppliers</option>
            {suppliers.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select
            value={filterFacility}
            onChange={(e) => setFilterFacility(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            <option value="ALL">All Facilities</option>
            {facilityNames.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>

          <span className="text-sm text-gray-500 ml-auto">
            {filteredRows.length}/{rows.length} rows
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="max-h-[600px] overflow-y-auto">
        {/* Header */}
        <div className="border-b border-gray-300 bg-white sticky top-0 z-20 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]">
          <div className="flex">
            <div className="w-[150px] min-w-[150px] px-3 py-3 border-r border-gray-300 text-center">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Facility</span>
            </div>
            <div className="w-[130px] min-w-[130px] px-3 py-3 border-r border-gray-300 text-center">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Supplier</span>
            </div>
            <div className="w-[120px] min-w-[120px] px-3 py-3 border-r border-gray-300 text-center">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Type</span>
            </div>
            <div className="flex-1 flex">
              {monthLabels.map((month) => {
                const parts = month.split(' ');
                const mon = parts[0]?.toUpperCase() || month;
                const yr = parts[1] || '';
                const isCurrentMonth = month === currentMonthLabel;
                return (
                  <div
                    key={month}
                    className={`flex-1 min-w-[60px] py-2 text-center border-r border-gray-200 last:border-r-0 ${
                      isCurrentMonth ? 'bg-orange-100' : 'bg-white'
                    }`}
                  >
                    <div className={`text-sm font-bold ${isCurrentMonth ? 'text-orange-700' : 'text-gray-700'}`}>
                      {mon}
                    </div>
                    <div className={`text-xs ${isCurrentMonth ? 'text-orange-600' : 'text-gray-500'}`}>
                      {yr}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Body */}
        <div>
          {filteredRows.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500 text-sm border-b border-gray-200">
              No rows match your filters.
            </div>
          ) : (
            filteredRows.map((row, rowIdx) => (
              <div
                key={`${row.facilityId}-${row.supplierId}-${row.categoryId}`}
                className="flex border-b border-gray-200 last:border-b-0 hover:bg-gray-50/50"
              >
                <div className="w-[150px] min-w-[150px] px-3 py-3 border-r border-gray-200 flex items-center justify-center">
                  <div className="font-semibold text-gray-900 text-sm text-center" title={row.facilityName}>
                    {row.facilityName}
                  </div>
                </div>
                <div className="w-[130px] min-w-[130px] px-3 py-3 border-r border-gray-200 flex items-center justify-center">
                  <div className="text-sm text-gray-700 text-center" title={row.supplierName}>
                    {row.supplierName}
                  </div>
                </div>
                <div className="w-[120px] min-w-[120px] px-3 py-3 border-r border-gray-200 flex items-center justify-center">
                  <div className="text-sm text-gray-600 text-center">{row.categoryName}</div>
                </div>

                {/* Month cells */}
                <div className="flex-1 flex items-center py-1.5">
                  {row.coverage.map((cell, idx) => {
                    const isCurrentMonth = cell.month === currentMonthLabel;
                    const clickHandler = cell.record
                      ? () => onCellClick?.(cell.record!)
                      : onEmptyCellClick
                        ? () => onEmptyCellClick(row, cell)
                        : undefined;
                    return (
                      <div
                        key={idx}
                        className={`flex-1 min-w-[60px] px-1 ${isCurrentMonth ? 'bg-orange-50/50' : ''}`}
                      >
                        <NonMeteredCell
                          cell={cell}
                          onClick={clickHandler}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 py-3 bg-gray-100 border-t border-gray-300">
        <div className="flex items-center gap-5 text-sm flex-wrap">
          <span className="font-semibold text-gray-600">Legend:</span>
          <div className="flex items-center gap-2">
            <div className="w-8 h-5 bg-green-500 border border-green-600 rounded"></div>
            <span className="text-gray-700">Received</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-5 bg-slate-400 border border-slate-500 rounded"></div>
            <span className="text-gray-700">Inferred empty</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-5 bg-gray-200 border border-gray-300 rounded"></div>
            <span className="text-gray-700">No data</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------
// Individual month cell for non-metered grid
// -------------------------------------------------------
interface NonMeteredCellProps {
  cell: NonMeteredMonthlyCoverage;
  onClick?: () => void;
}

function NonMeteredCell({ cell, onClick }: NonMeteredCellProps) {
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const getBgColor = () => {
    if (cell.status === 'IMPORTED' || cell.status === 'MANUAL')
      return 'bg-green-500 border-green-600';
    if (cell.status === 'INFERRED_EMPTY')
      return 'bg-slate-400 border-slate-500';
    return 'bg-gray-200 border-gray-300';
  };

  const getLabel = () => {
    if (cell.status === 'IMPORTED' || cell.status === 'MANUAL') return '✓';
    if (cell.status === 'INFERRED_EMPTY') return '0';
    if (!cell.status && onClick) return '+';
    return '—';
  };

  const getTextColor = () => {
    if (!cell.status) return onClick ? 'text-gray-400 group-hover:text-gray-600' : 'text-gray-400';
    if (cell.status === 'INFERRED_EMPTY') return 'text-white';
    return 'text-white';
  };

  const getTooltip = () => {
    if (cell.status === 'IMPORTED') return 'Invoice received';
    if (cell.status === 'MANUAL') return 'Marked as received';
    if (cell.status === 'INFERRED_EMPTY') return 'Inferred empty — click to mark as received';
    if (onClick) return 'No data — click to mark as received';
    return 'No data';
  };

  const handleMouseEnter = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setTooltipPos({ x: rect.left + rect.width / 2, y: rect.bottom + 8 });
    }
  };

  const content = (
    <div
      className={`h-7 ${getBgColor()} border rounded flex items-center justify-center ${
        onClick ? 'hover:brightness-110 hover:shadow-md transition-all cursor-pointer' : ''
      }`}
    >
      <span className={`text-xs font-bold ${getTextColor()} drop-shadow-sm`}>{getLabel()}</span>
    </div>
  );

  if (!onClick) {
    return (
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setTooltipPos(null)}
        className="relative"
      >
        {content}
        <CellTooltip pos={tooltipPos} text={getTooltip()} />
      </div>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setTooltipPos(null)}
        className="focus:outline-none w-full"
      >
        {content}
      </button>
      <CellTooltip pos={tooltipPos} text={getTooltip()} />
    </>
  );
}

function CellTooltip({ pos, text }: { pos: { x: number; y: number } | null; text: string }) {
  if (!pos) return null;
  return (
    <div
      className="fixed z-[9999] bg-gray-900 text-white text-xs rounded px-3 py-2 shadow-xl pointer-events-none whitespace-nowrap"
      style={{ left: pos.x, top: pos.y, transform: 'translateX(-50%)' }}
    >
      {text}
      <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
    </div>
  );
}
