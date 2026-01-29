'use client';

import { useState } from 'react';
import ProgressBarCell from './ProgressBarCell';
import type { MeterWithCoverage } from '@/types';

interface CoverageTableProps {
  metersWithCoverage: MeterWithCoverage[];
  fiscalYear: number;
}

export default function CoverageTable({ metersWithCoverage, fiscalYear }: CoverageTableProps) {
  const [filterUtility, setFilterUtility] = useState<string>('ALL');
  
  // Get unique utility types
  const utilityTypes = Array.from(
    new Set(metersWithCoverage.map(m => m.meter.utility_category?.name || 'UNKNOWN'))
  );
  
  // Filter meters by utility type
  const filteredMeters = filterUtility === 'ALL' 
    ? metersWithCoverage 
    : metersWithCoverage.filter(m => m.meter.utility_category?.name === filterUtility);
  
  if (filteredMeters.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <p className="text-gray-500">No meters found. Upload invoices to see coverage data.</p>
      </div>
    );
  }
  
  // Get month labels from first meter's coverage (all meters have same months)
  const monthLabels = filteredMeters[0]?.coverage.map(c => c.month) || [];
  
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* Filter Controls */}
      <div className="p-4 bg-gray-50 border-b">
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700">Filter by Utility:</label>
          <select
            value={filterUtility}
            onChange={(e) => setFilterUtility(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Utilities</option>
            {utilityTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <span className="text-sm text-gray-500">
            Showing {filteredMeters.length} meters
          </span>
        </div>
      </div>
      
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b sticky top-0">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">
                Facility
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                Supplier
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                Meter ID
              </th>
              {monthLabels.map(month => (
                <th key={month} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-28">
                  {month}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredMeters.map(({ meter, coverage }) => (
              <tr key={meter.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm text-gray-900">
                  {meter.facility?.name || 'Unknown'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {meter.supplier?.name || 'No Supplier'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                    {meter.utility_category?.name || 'N/A'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                  {meter.lookup1.substring(0, 12)}
                  {meter.lookup1.length > 12 && '...'}
                </td>
                {coverage.map((monthlyCoverage, idx) => (
                  <td key={idx} className="px-2 py-3">
                    <ProgressBarCell coverage={monthlyCoverage} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Legend */}
      <div className="p-4 bg-gray-50 border-t">
        <div className="flex items-center gap-6 text-xs">
          <span className="font-medium text-gray-700">Coverage Legend:</span>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500 rounded"></div>
            <span className="text-gray-600">100%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-yellow-500 rounded"></div>
            <span className="text-gray-600">85-99%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-orange-500 rounded"></div>
            <span className="text-gray-600">50-84%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500 rounded"></div>
            <span className="text-gray-600">1-49%</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gray-400 rounded"></div>
            <span className="text-gray-600">0%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
