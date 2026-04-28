'use client';

import { useState, useMemo } from 'react';
import ProgressBarCell from './ProgressBarCell';
import type { MeterWithCoverage, ActualInvoice } from '@/types';

import { format, endOfMonth, startOfMonth, isAfter, parseISO, isValid } from 'date-fns';

function coerceMonthDate(monthDate: Date | string): Date {
  if (monthDate instanceof Date) return monthDate;
  const d = parseISO(String(monthDate));
  return isValid(d) ? d : new Date(String(monthDate));
}

/** Months strictly after the current calendar month (inactive line / meter — no data expected). */
function isInactiveForwardMonth(monthDate: Date | string, explicitlyInactive: boolean): boolean {
  if (!explicitlyInactive) return false;
  const md = coerceMonthDate(monthDate);
  return isAfter(startOfMonth(md), endOfMonth(new Date()));
}

interface CoverageTableProps {
  metersWithCoverage: MeterWithCoverage[];
  fiscalYear: number;
  onQuickAddInvoice?: (opts: { meterId: string; facilityId?: string; period_start_date: string; period_end_date: string; invoices?: ActualInvoice[] }) => void;
  onMeterUpdated?: () => void;
  showCategoryColumn?: boolean;
}

type SortColumn =
  | 'default'
  | 'facility'
  | 'supplier'
  | 'category'
  | 'type'
  | 'identifier'
  | 'status';

export default function CoverageTable({ metersWithCoverage, fiscalYear, onQuickAddInvoice, onMeterUpdated, showCategoryColumn = false }: CoverageTableProps) {
  const [filterUtility, setFilterUtility] = useState<string>('ALL');
  const [filterSupplier, setFilterSupplier] = useState<string>('ALL');
  const [filterFacility, setFilterFacility] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [sortColumn, setSortColumn] = useState<SortColumn>('default');
  const [sortAscending, setSortAscending] = useState(true);
  const [togglingIsActive, setTogglingIsActive] = useState<string | null>(null);

  const toggleIsActive = async (meterId: string, currentIsActive: boolean) => {
    setTogglingIsActive(meterId);
    try {
      const res = await fetch(`/api/meters/${meterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !currentIsActive })
      });
      if (res.ok) onMeterUpdated?.();
    } catch (err) {
      console.error('Error toggling is_active:', err);
    } finally {
      setTogglingIsActive(null);
    }
  };

  const getDisplayStatus = (meter: MeterWithCoverage['meter']) => {
    if (meter.is_active === false) return { label: 'Inactive', color: 'bg-gray-100 text-gray-500' };
    if (meter.needs_attention) return { label: 'Needs attention', color: 'bg-amber-100 text-amber-700' };
    const status = getMeterServiceStatus(meter);
    return status.isActive
      ? { label: 'Active', color: 'bg-green-100 text-green-700' }
      : { label: 'Inactive', color: 'bg-gray-100 text-gray-500' };
  };

  const formatIdentifierType = (type: string): string => {
    const typeMap: Record<string, string> = {
      'NMI': 'NMI',
      'MIRN': 'MIRN',
      'ACCOUNT_NUMBER': 'Account Number',
      'METER_NUMBER': 'Meter Number',
      'REGISTRATION_PLATE': 'Rego Plate',
      'CARD_NUMBER': 'Card Number',
      'FACILITY_LEVEL': 'Facility Level',
      'DESCRIPTION': 'Description'
    };
    return typeMap[type] || type;
  };

  const getMeterServiceStatus = (meter: MeterWithCoverage['meter']): { label: string; isActive: boolean } => {
    if (meter.is_active === false) return { label: 'Inactive', isActive: false };
    const today = new Date().toISOString().split('T')[0];
    if (meter.in_service_end_date && meter.in_service_end_date <= today) {
      return { label: 'Inactive', isActive: false };
    }
    if (meter.in_service_start_date && meter.in_service_start_date > today) {
      return { label: 'Pending', isActive: false };
    }
    return { label: 'Active', isActive: true };
  };
  
  const utilityTypes = Array.from(
    new Set(metersWithCoverage.map(m => m.meter.input_type?.name || 'UNKNOWN'))
  );
  
  const suppliers = Array.from(
    new Set(metersWithCoverage.map(m => m.meter.supplier?.name || 'No Supplier'))
  ).sort();
  
  const facilities = Array.from(
    new Set(metersWithCoverage.map(m => m.meter.facility?.name || 'Unknown'))
  ).sort();
  
  const filteredMeters = metersWithCoverage.filter(m => {
    const utilityMatch = filterUtility === 'ALL' || m.meter.input_type?.name === filterUtility;
    const supplierMatch = filterSupplier === 'ALL' || (m.meter.supplier?.name || 'No Supplier') === filterSupplier;
    const facilityMatch = filterFacility === 'ALL' || (m.meter.facility?.name || 'Unknown') === filterFacility;
    
    const isExplicitlyInactive = m.meter.is_active === false;
    const status = getMeterServiceStatus(m.meter);
    const statusMatch = filterStatus === 'ALL' ||
      (filterStatus === 'ACTIVE' && status.isActive && !m.meter.needs_attention && !isExplicitlyInactive) ||
      (filterStatus === 'INACTIVE' && (!status.isActive || isExplicitlyInactive)) ||
      (filterStatus === 'NEEDS_ATTENTION' && m.meter.needs_attention && !isExplicitlyInactive);
    
    return utilityMatch && supplierMatch && facilityMatch && statusMatch;
  });

  const sortedMeters = useMemo(() => {
    if (sortColumn === 'default') return filteredMeters;

    const sortValue = (row: MeterWithCoverage): string => {
      const meter = row.meter;
      switch (sortColumn) {
        case 'facility':
          return meter.facility?.name || 'Unknown';
        case 'supplier':
          return meter.supplier?.name || 'No Supplier';
        case 'category':
          return meter.category?.name || '';
        case 'type':
          return meter.input_type?.name || 'N/A';
        case 'identifier': {
          const lookup = meter.lookup1 || '';
          const idKind = formatIdentifierType(meter.identifier_type);
          return `${lookup}\u0000${idKind}`;
        }
        case 'status':
          return getDisplayStatus(meter).label;
        default:
          return '';
      }
    };

    const mult = sortAscending ? 1 : -1;
    return [...filteredMeters].sort(
      (a, b) => sortValue(a).localeCompare(sortValue(b), undefined, { sensitivity: 'base' }) * mult
    );
  }, [filteredMeters, sortColumn, sortAscending]);
  
  if (metersWithCoverage.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
        <p className="text-gray-500">No meters found. Upload invoices to see coverage data.</p>
      </div>
    );
  }
  
  const monthLabels = metersWithCoverage[0]?.coverage.map(c => c.month) || [];
  const now = new Date();
  const currentMonthYearLabel = format(now, 'MMM yy');
  
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Filter Controls */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Filters:</span>
          
          <select
            value={filterUtility}
            onChange={(e) => setFilterUtility(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            <option value="ALL">All Types</option>
            {utilityTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          
          <select
            value={filterSupplier}
            onChange={(e) => setFilterSupplier(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            <option value="ALL">All Suppliers</option>
            {suppliers.map(supplier => (
              <option key={supplier} value={supplier}>{supplier}</option>
            ))}
          </select>
          
          <select
            value={filterFacility}
            onChange={(e) => setFilterFacility(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            <option value="ALL">All Facilities</option>
            {facilities.map(facility => (
              <option key={facility} value={facility}>{facility}</option>
            ))}
          </select>
          
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="NEEDS_ATTENTION">Needs attention</option>
          </select>

          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide ml-1">Sort:</span>
          <select
            value={sortColumn}
            onChange={(e) => {
              const v = e.target.value as SortColumn;
              setSortColumn(v);
              if (v === 'default') setSortAscending(true);
            }}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            <option value="default">Table order</option>
            <option value="facility">Facility</option>
            <option value="supplier">Supplier</option>
            {showCategoryColumn && <option value="category">Category</option>}
            <option value="type">{showCategoryColumn ? 'Input type' : 'Type'}</option>
            <option value="identifier">Identifier</option>
            <option value="status">Status</option>
          </select>
          <select
            value={sortAscending ? 'asc' : 'desc'}
            onChange={(e) => setSortAscending(e.target.value === 'asc')}
            disabled={sortColumn === 'default'}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="asc">A → Z</option>
            <option value="desc">Z → A</option>
          </select>
          
          <span className="text-sm text-gray-500 ml-auto">
            {sortedMeters.length}/{metersWithCoverage.length} meters
          </span>
        </div>
      </div>
      
      {/* Scrollable container with sticky header */}
      <div className="max-h-[600px] overflow-y-auto">
        {/* Calendar-style Grid Header */}
        <div className="border-b border-gray-300 bg-white sticky top-0 z-20 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]">
          <div className="flex">
            {/* Meter info column headers */}
            <div className="w-[150px] min-w-[150px] px-3 py-3 border-r border-gray-300 text-center">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Facility</span>
            </div>
            <div className="w-[130px] min-w-[130px] px-3 py-3 border-r border-gray-300 text-center">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Supplier</span>
            </div>
            {showCategoryColumn && (
              <div className="w-[160px] min-w-[160px] px-3 py-3 border-r border-gray-300 text-center">
                <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Category</span>
              </div>
            )}
            <div className="w-[110px] min-w-[110px] px-3 py-3 border-r border-gray-300 text-center">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                {showCategoryColumn ? 'Input Type' : 'Type'}
              </span>
            </div>
            <div className="w-[160px] min-w-[160px] px-3 py-3 border-r border-gray-300 text-center">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Identifier</span>
            </div>
            <div className="w-[80px] min-w-[80px] px-2 py-3 border-r border-gray-300 text-center">
              <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Status</span>
            </div>
            
            {/* Month headers - calendar style */}
            <div className="flex-1 flex">
              {monthLabels.map((month) => {
                const parts = month.split(' ');
                const mon = parts[0]?.toUpperCase() || month;
                const yr = parts[1] || '';
                const isCurrentMonth = month === currentMonthYearLabel;
                
                return (
                  <div 
                    key={month} 
                    className={`flex-1 min-w-[60px] py-2 text-center border-r border-gray-200 last:border-r-0 ${isCurrentMonth ? 'bg-orange-100' : 'bg-white'}`}
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
        
        {/* Calendar-style Grid Body */}
        <div>
        {sortedMeters.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-500 text-sm border-b border-gray-200">
            No meters match your filters.
          </div>
        ) : sortedMeters.map(({ meter, coverage }) => {
          const status = getMeterServiceStatus(meter);
          return (
            <div key={meter.id} className="flex border-b border-gray-200 last:border-b-0 hover:bg-gray-50/50">
              {/* Meter info columns */}
              <div className="w-[150px] min-w-[150px] px-3 py-3 border-r border-gray-200 flex items-center justify-center">
                <div className="font-semibold text-gray-900 text-sm text-center" title={meter.facility?.name}>
                  {meter.facility?.name || 'Unknown'}
                </div>
              </div>
              <div className="w-[130px] min-w-[130px] px-3 py-3 border-r border-gray-200 flex items-center justify-center">
                <div className="text-sm text-gray-700 text-center" title={meter.supplier?.name}>
                  {meter.supplier?.name || '—'}
                </div>
              </div>
              {showCategoryColumn && (
                <div className="w-[160px] min-w-[160px] px-3 py-3 border-r border-gray-200 flex items-center justify-center">
                  <div className="text-sm text-gray-600 text-center">
                    {meter.category?.name || <span className="text-gray-400">—</span>}
                  </div>
                </div>
              )}
              <div className="w-[110px] min-w-[110px] px-3 py-3 border-r border-gray-200 flex items-center justify-center">
                <div className="text-sm text-gray-600 text-center">
                  {meter.input_type?.name || 'N/A'}
                </div>
              </div>
              <div className="w-[160px] min-w-[160px] px-3 py-3 border-r border-gray-200 text-center">
                <div className="text-xs text-gray-400 mb-0.5">
                  {formatIdentifierType(meter.identifier_type)}
                </div>
                <div className="text-sm text-gray-700 font-medium truncate" title={meter.lookup1}>
                  {meter.lookup1 || '—'}
                </div>
              </div>
              <div className="w-[80px] min-w-[80px] px-2 py-3 border-r border-gray-200 flex items-center justify-center">
                <button
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleIsActive(meter.id, meter.is_active !== false); }}
                  disabled={togglingIsActive === meter.id}
                  title={meter.is_active === false ? 'Mark as active' : 'Mark as inactive'}
                  className={`px-2 py-1 rounded text-xs font-semibold cursor-pointer hover:opacity-80 transition-opacity ${
                    getDisplayStatus(meter).color
                  }`}
                >
                  {togglingIsActive === meter.id ? '…' : getDisplayStatus(meter).label}
                </button>
              </div>
              
              {/* Month cells - calendar event style */}
              <div className="flex-1 flex items-center py-1.5">
                {coverage.map((monthlyCoverage, idx) => {
                  const md = coerceMonthDate(monthlyCoverage.monthDate);
                  const period_start_date = format(md, 'yyyy-MM-dd');
                  const period_end_date = format(endOfMonth(md), 'yyyy-MM-dd');
                  
                  const monthStart = period_start_date;
                  const monthEnd = period_end_date;
                  
                  const beforeServiceStart = !!(meter.in_service_start_date && monthEnd < meter.in_service_start_date);
                  const afterServiceEnd = !!(meter.in_service_end_date && monthStart >= meter.in_service_end_date);
                  
                  const isMonthDisabled = beforeServiceStart || afterServiceEnd;
                  const inactiveForward = isInactiveForwardMonth(
                    monthlyCoverage.monthDate,
                    meter.is_active === false
                  );
                  const cellCoverage = inactiveForward
                    ? {
                        ...monthlyCoverage,
                        monthDate: md,
                        daysCovered: 0,
                        percentage: 0,
                        effectiveDaysInMonth: monthlyCoverage.daysInMonth,
                        isDeactivatedMonth: true,
                        gaps: undefined,
                      }
                    : { ...monthlyCoverage, monthDate: md };
                  const isCurrentMonth = monthlyCoverage.month === currentMonthYearLabel;
                  
                  return (
                    <div 
                      key={idx} 
                      className={`flex-1 min-w-[60px] px-1 ${isCurrentMonth ? 'bg-orange-50/50' : ''}`}
                    >
                      <ProgressBarCell
                        coverage={cellCoverage}
                        disabled={isMonthDisabled && !inactiveForward}
                        onClick={
                          inactiveForward
                            ? undefined
                            : () => onQuickAddInvoice?.({
                                meterId: String(meter.id),
                                facilityId: meter.facility?.id,
                                period_start_date,
                                period_end_date,
                                invoices: monthlyCoverage.invoices
                              })
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>
      </div>
      
      {/* Legend */}
      <div className="px-4 py-3 bg-gray-100 border-t border-gray-300">
        <div className="flex items-center gap-5 text-sm">
          <span className="font-semibold text-gray-600">Legend:</span>
          <div className="flex items-center gap-2">
            <div className="w-8 h-5 bg-green-500 border border-green-600 rounded"></div>
            <span className="text-gray-700">100%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-5 bg-yellow-400 border border-yellow-500 rounded"></div>
            <span className="text-gray-700">85-99%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-5 bg-orange-500 border border-orange-600 rounded"></div>
            <span className="text-gray-700">50-84%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-5 bg-red-500 border border-red-600 rounded"></div>
            <span className="text-gray-700">1-49%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-5 bg-gray-200 border border-gray-300 rounded"></div>
            <span className="text-gray-700">0%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-5 bg-slate-500 border border-slate-600 rounded"></div>
            <span className="text-gray-700">Deactivated</span>
          </div>
        </div>
      </div>
    </div>
  );
}
