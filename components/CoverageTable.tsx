'use client';

import { useState } from 'react';
import ProgressBarCell from './ProgressBarCell';
import type { MeterWithCoverage, ActualInvoice } from '@/types';

import { format, endOfMonth } from 'date-fns';

interface CoverageTableProps {
  metersWithCoverage: MeterWithCoverage[];
  fiscalYear: number;
  onQuickAddInvoice?: (opts: { meterId: string; facilityId?: string; period_start_date: string; period_end_date: string; invoices?: ActualInvoice[] }) => void;
}

export default function CoverageTable({ metersWithCoverage, fiscalYear, onQuickAddInvoice }: CoverageTableProps) {
  const [filterUtility, setFilterUtility] = useState<string>('ALL');
  const [filterSupplier, setFilterSupplier] = useState<string>('ALL');
  const [filterFacility, setFilterFacility] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  const getMeterServiceStatus = (meter: MeterWithCoverage['meter']): { label: string; color: string; isActive: boolean } => {
    const today = new Date().toISOString().split('T')[0];
    // Mark as inactive if end date is set and is today or in the past
    if (meter.in_service_end_date && meter.in_service_end_date <= today) {
      return { label: 'Inactive', color: 'bg-gray-200 text-gray-600', isActive: false };
    }
    // Mark as not yet active if start date is in the future
    if (meter.in_service_start_date && meter.in_service_start_date > today) {
      return { label: 'Not Yet Active', color: 'bg-yellow-100 text-yellow-700', isActive: false };
    }
    return { label: 'Active', color: 'bg-green-100 text-green-700', isActive: true };
  };
  
  // Get unique utility types, suppliers, and facilities
  const utilityTypes = Array.from(
    new Set(metersWithCoverage.map(m => m.meter.utility_category?.name || 'UNKNOWN'))
  );
  
  const suppliers = Array.from(
    new Set(metersWithCoverage.map(m => m.meter.supplier?.name || 'No Supplier'))
  ).sort();
  
  const facilities = Array.from(
    new Set(metersWithCoverage.map(m => m.meter.facility?.name || 'Unknown'))
  ).sort();
  
  // Filter meters by all selected criteria
  const filteredMeters = metersWithCoverage.filter(m => {
    const utilityMatch = filterUtility === 'ALL' || m.meter.utility_category?.name === filterUtility;
    const supplierMatch = filterSupplier === 'ALL' || (m.meter.supplier?.name || 'No Supplier') === filterSupplier;
    const facilityMatch = filterFacility === 'ALL' || (m.meter.facility?.name || 'Unknown') === filterFacility;
    
    const status = getMeterServiceStatus(m.meter);
    const statusMatch = filterStatus === 'ALL' || 
      (filterStatus === 'ACTIVE' && status.isActive) ||
      (filterStatus === 'INACTIVE' && !status.isActive);
    
    return utilityMatch && supplierMatch && facilityMatch && statusMatch;
  });
  
  // Show empty state only when there are no meters at all
  if (metersWithCoverage.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <p className="text-gray-500">No meters found. Upload invoices to see coverage data.</p>
      </div>
    );
  }
  
  // Get month labels from first meter's coverage (all meters have same months)
  const monthLabels = metersWithCoverage[0]?.coverage.map(c => c.month) || [];
  
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* Filter Controls */}
      <div className="p-4 bg-gray-50 border-b">
        <div className="flex flex-wrap items-center gap-4">
          <label className="text-sm font-medium text-gray-700">Filters:</label>
          
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Utility:</label>
            <select
              value={filterUtility}
              onChange={(e) => setFilterUtility(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All</option>
              {utilityTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Supplier:</label>
            <select
              value={filterSupplier}
              onChange={(e) => setFilterSupplier(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All</option>
              {suppliers.map(supplier => (
                <option key={supplier} value={supplier}>{supplier}</option>
              ))}
            </select>
          </div>
          
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Facility:</label>
            <select
              value={filterFacility}
              onChange={(e) => setFilterFacility(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All</option>
              {facilities.map(facility => (
                <option key={facility} value={facility}>{facility}</option>
              ))}
            </select>
          </div>
          
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Status:</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All</option>
              <option value="ACTIVE">Active Only</option>
              <option value="INACTIVE">Inactive Only</option>
            </select>
          </div>
          
          <span className="text-sm text-gray-500 ml-auto">
            Showing {filteredMeters.length} of {metersWithCoverage.length} meters
          </span>
        </div>
      </div>
      
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b sticky top-0 z-50">
            <tr>
              <th className="px-4 py-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider w-48 align-middle">
                Facility
              </th>
              <th className="px-4 py-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider w-32 align-middle">
                Supplier
              </th>
              <th className="px-4 py-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider w-24 align-middle">
                Type
              </th>
              <th className="px-4 py-4 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider w-32 align-middle">
                Meter ID
              </th>
              <th className="px-4 py-4 text-center text-sm font-semibold text-gray-600 uppercase tracking-wider w-24 align-middle">
                Status
              </th>
              {monthLabels.map(month => {
                const parts = month.split(' ');
                const mon = parts[0] || month;
                const yr = parts[1] || '';
                
                // Check if this is the current month-year (format: "MMM yy" e.g. "Jan 26")
                const now = new Date();
                const currentMonthYearLabel = format(now, 'MMM yy');
                const isCurrentMonth = month === currentMonthYearLabel;
                
                return (
                  <th key={month} className="px-3 py-4 text-center text-sm font-medium text-gray-500 uppercase tracking-wider w-36 whitespace-nowrap">
                    <div className={`relative inline-block px-3 py-2 rounded-lg ${isCurrentMonth ? 'bg-blue-100' : ''}`}>
                      {isCurrentMonth && (
                        <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] text-blue-600 font-medium">Current</div>
                      )}
                      <div className="text-base font-semibold leading-5">{mon}</div>
                      <div className="text-sm text-gray-400 mt-1">{yr}</div>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredMeters.length === 0 ? (
              <tr>
                <td colSpan={5 + monthLabels.length} className="px-4 py-8 text-center text-gray-500">
                  No meters match your filters.
                </td>
              </tr>
            ) : filteredMeters.map(({ meter, coverage }) => {
              const status = getMeterServiceStatus(meter);
              return (
              <tr key={meter.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm text-gray-900 align-middle">
                  {meter.facility?.name || 'Unknown'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 align-middle">
                  {meter.supplier?.name || 'No Supplier'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 align-middle">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                    {meter.utility_category?.name || 'N/A'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 font-mono align-middle">
                  {meter.lookup1 ? (meter.lookup1.length > 20 ? `${meter.lookup1.substring(0,20)}...` : meter.lookup1) : '(no id)'}
                  {meter.identifier_type ? <div className="text-xs text-gray-400 mt-1">{meter.identifier_type}</div> : null}
                </td>
                <td className="px-4 py-3 text-sm text-center align-middle">
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                    status.isActive 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-red-100 text-red-700'
                  }`}>
                    {status.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                {coverage.map((monthlyCoverage, idx) => {
                  const period_start_date = format(monthlyCoverage.monthDate, 'yyyy-MM-dd');
                  const period_end_date = format(endOfMonth(monthlyCoverage.monthDate), 'yyyy-MM-dd');
                  
                  // Check if this specific month is within the meter's service period
                  const monthStart = period_start_date;
                  const monthEnd = period_end_date;
                  
                  // Meter wasn't in service yet for this month
                  const beforeServiceStart = meter.in_service_start_date && monthEnd < meter.in_service_start_date;
                  // Meter was already out of service for this month
                  const afterServiceEnd = meter.in_service_end_date && monthStart > meter.in_service_end_date;
                  
                  const isMonthDisabled = beforeServiceStart || afterServiceEnd;
                  
                  return (
                    <td key={idx} className="px-3 py-3 align-middle">
                      <ProgressBarCell
                        coverage={monthlyCoverage}
                        disabled={isMonthDisabled}
                        onClick={() => onQuickAddInvoice?.({
                          meterId: String(meter.id),
                          facilityId: meter.facility?.id,
                          period_start_date,
                          period_end_date,
                          invoices: monthlyCoverage.invoices
                        })}
                      />
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      {/* Legend */}
      <div className="p-4 bg-gray-50 border-t">
        <div className="flex items-center gap-6 text-sm">
          <span className="font-medium text-gray-700">Coverage Legend:</span>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-green-500 rounded"></div>
            <span className="text-gray-600">100%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-yellow-500 rounded"></div>
            <span className="text-gray-600">85-99%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-orange-500 rounded"></div>
            <span className="text-gray-600">50-84%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-red-500 rounded"></div>
            <span className="text-gray-600">1-49%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-gray-400 rounded"></div>
            <span className="text-gray-600">0%</span>
          </div>
        </div>
      </div>
    </div>
  );
}