'use client';

import { useState, useEffect } from 'react';

interface InvoiceFormProps {
  clientId: string;
  onSubmit: (data: InvoiceFormData) => Promise<void>;
  onCancel?: () => void;
}

export interface InvoiceFormData {
  meter_id: string;
  invoice_number?: string;
  invoice_date?: string;
  period_start_date: string;
  period_end_date: string;
  consumption?: number;
  amount?: number;
  framework?: string;
  version?: string;
  input_type?: string;
  emissions_factor?: number;
  customer?: string;
}

interface Facility {
  id: string | number;
  name: string;
}

interface Meter {
  id: string | number;
  facility_id: string | number;
  lookup1: string;
  identifier_type: string;
  utility_category: { name: string };
  supplier?: { name: string } | null;
}

export default function InvoiceForm({ clientId, onSubmit, onCancel }: InvoiceFormProps) {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [allMeters, setAllMeters] = useState<Meter[]>([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState('');
  const [filteredMeters, setFilteredMeters] = useState<Meter[]>([]);
  
  // Helper functions for date handling
  const getCurrentMonthStart = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  };
  
  const getCurrentMonthEnd = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  };
  
  const getMonthStart = (year: number, month: number) => {
    return new Date(year, month, 1).toISOString().split('T')[0];
  };
  
  const getMonthEnd = (year: number, month: number) => {
    return new Date(year, month + 1, 0).toISOString().split('T')[0];
  };
  
  const [formData, setFormData] = useState<InvoiceFormData>({
    meter_id: '',
    invoice_number: '',
    invoice_date: '',
    period_start_date: getCurrentMonthStart(),
    period_end_date: getCurrentMonthEnd(),
    consumption: undefined,
    amount: undefined,
    framework: '',
    version: '',
    input_type: '',
    emissions_factor: undefined,
    customer: ''
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  // Quick date selectors state
  const [quickYear, setQuickYear] = useState(new Date().getFullYear());
  const [quickMonth, setQuickMonth] = useState(new Date().getMonth());
  
  // Generate year options (current year ± 5 years)
  const yearOptions = Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i);
  
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  
  useEffect(() => {
    fetchData();
  }, [clientId]);
  
  useEffect(() => {
    if (selectedFacilityId) {
      const filtered = allMeters.filter(m => String(m.facility_id) === String(selectedFacilityId));
      setFilteredMeters(filtered);
      // Reset meter selection if it doesn't match facility
      if (formData.meter_id && !filtered.find(m => String(m.id) === String(formData.meter_id))) {
        setFormData({ ...formData, meter_id: '' });
      }
    } else {
      setFilteredMeters(allMeters);
    }
  }, [selectedFacilityId, allMeters, formData.meter_id]);
  
  // When start date changes, update end date to stay in the same month
  useEffect(() => {
    if (formData.period_start_date) {
      const startDate = new Date(formData.period_start_date);
      const year = startDate.getFullYear();
      const month = startDate.getMonth();
      
      // Update quick selectors to match
      setQuickYear(year);
      setQuickMonth(month);
      
      // If end date is empty or in a different month, set it to end of start date's month
      if (!formData.period_end_date) {
        setFormData(prev => ({
          ...prev,
          period_end_date: getMonthEnd(year, month)
        }));
      } else {
        const endDate = new Date(formData.period_end_date);
        if (endDate.getFullYear() !== year || endDate.getMonth() !== month) {
          // Only auto-update if end date is before start date
          if (endDate < startDate) {
            setFormData(prev => ({
              ...prev,
              period_end_date: getMonthEnd(year, month)
            }));
          }
        }
      }
    }
  }, [formData.period_start_date]);
  
  // Handle quick year/month selection
  const handleQuickDateChange = (year: number, month: number) => {
    setQuickYear(year);
    setQuickMonth(month);
    setFormData(prev => ({
      ...prev,
      period_start_date: getMonthStart(year, month),
      period_end_date: getMonthEnd(year, month)
    }));
  };
  
  const fetchData = async () => {
    try {
      // Fetch facilities
      const facilitiesRes = await fetch(`/api/clients/${clientId}/facilities`);
      const facilitiesData = await facilitiesRes.json();
      setFacilities(facilitiesData);
      
      // Fetch all meters for this client
      const metersRes = await fetch(`/api/clients/${clientId}/meters`);
      const metersData = await metersRes.json();
      setAllMeters(metersData);
      setFilteredMeters(metersData);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load facilities and meters');
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!formData.meter_id || !formData.period_start_date || !formData.period_end_date) {
      setError('Please fill in all required fields');
      return;
    }
    
    // Validate dates
    const startDate = new Date(formData.period_start_date);
    const endDate = new Date(formData.period_end_date);
    
    if (endDate < startDate) {
      setError('End date must be after start date');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      await onSubmit(formData);
      
      // Reset form with current month as default
      setFormData({
        meter_id: '',
        invoice_number: '',
        invoice_date: '',
        period_start_date: getCurrentMonthStart(),
        period_end_date: getCurrentMonthEnd(),
        consumption: undefined,
        amount: undefined,
        framework: '',
        version: '',
        input_type: '',
        emissions_factor: undefined,
        customer: ''
      });
      setSelectedFacilityId('');
      setQuickYear(new Date().getFullYear());
      setQuickMonth(new Date().getMonth());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invoice');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}
      
      {allMeters.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
          No meters found. Please add a meter first before creating invoices.
        </div>
      )}
      
      {/* Quick Year/Month Selector */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Quick Date Selection
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="quick_year" className="block text-xs text-gray-600 mb-1">
              Year
            </label>
            <select
              id="quick_year"
              value={quickYear}
              onChange={(e) => handleQuickDateChange(parseInt(e.target.value), quickMonth)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              disabled={isSubmitting}
            >
              {yearOptions.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label htmlFor="quick_month" className="block text-xs text-gray-600 mb-1">
              Month
            </label>
            <select
              id="quick_month"
              value={quickMonth}
              onChange={(e) => handleQuickDateChange(quickYear, parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              disabled={isSubmitting}
            >
              {monthNames.map((month, index) => (
                <option key={index} value={index}>{month}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Select a year and month to quickly set the billing period
        </p>
      </div>
      
      <div>
        <label htmlFor="facility_filter" className="block text-sm font-medium text-gray-700 mb-1">
          Filter by Facility (Optional)
        </label>
        <select
          id="facility_filter"
          value={selectedFacilityId}
          onChange={(e) => setSelectedFacilityId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isSubmitting}
        >
          <option value="">All Facilities</option>
          {facilities.map(facility => (
            <option key={facility.id} value={String(facility.id)}>{facility.name}</option>
          ))}
        </select>
      </div>
      
      <div>
        <label htmlFor="meter" className="block text-sm font-medium text-gray-700 mb-1">
          Meter <span className="text-red-500">*</span>
        </label>
        <select
          id="meter"
          value={formData.meter_id}
          onChange={(e) => setFormData({ ...formData, meter_id: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
          disabled={isSubmitting || allMeters.length === 0}
        >
          <option value="">Select a meter</option>
          {filteredMeters.map(meter => (
            <option key={meter.id} value={String(meter.id)}>
              {meter.utility_category.name} - {meter.supplier?.name || 'No Supplier'} - {meter.lookup1}
            </option>
          ))}
        </select>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="period_start_date" className="block text-sm font-medium text-gray-700 mb-1">
            Period Start Date <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            id="period_start_date"
            value={formData.period_start_date}
            onChange={(e) => setFormData({ ...formData, period_start_date: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
            disabled={isSubmitting}
          />
          <p className="text-xs text-gray-500 mt-1">You can type the date (YYYY-MM-DD) or use the picker</p>
        </div>
        
        <div>
          <label htmlFor="period_end_date" className="block text-sm font-medium text-gray-700 mb-1">
            Period End Date <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            id="period_end_date"
            value={formData.period_end_date}
            onChange={(e) => setFormData({ ...formData, period_end_date: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
            disabled={isSubmitting}
          />
          <p className="text-xs text-gray-500 mt-1">You can type the date (YYYY-MM-DD) or use the picker</p>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="invoice_number" className="block text-sm font-medium text-gray-700 mb-1">
            Invoice Number
          </label>
          <input
            type="text"
            id="invoice_number"
            value={formData.invoice_number}
            onChange={(e) => setFormData({ ...formData, invoice_number: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="INV-2024-001"
            disabled={isSubmitting}
          />
        </div>
        
        <div>
          <label htmlFor="invoice_date" className="block text-sm font-medium text-gray-700 mb-1">
            Invoice Date
          </label>
          <input
            type="date"
            id="invoice_date"
            value={formData.invoice_date}
            onChange={(e) => setFormData({ ...formData, invoice_date: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isSubmitting}
          />
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="consumption" className="block text-sm font-medium text-gray-700 mb-1">
            Consumption
          </label>
          <input
            type="number"
            step="0.01"
            id="consumption"
            value={formData.consumption || ''}
            onChange={(e) => setFormData({ ...formData, consumption: e.target.value ? parseFloat(e.target.value) : undefined })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="1250.5"
            disabled={isSubmitting}
          />
        </div>
        
        <div>
          <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">
            Amount ($)
          </label>
          <input
            type="number"
            step="0.01"
            id="amount"
            value={formData.amount || ''}
            onChange={(e) => setFormData({ ...formData, amount: e.target.value ? parseFloat(e.target.value) : undefined })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="425.75"
            disabled={isSubmitting}
          />
        </div>
      </div>
      
      <div>
        <label htmlFor="customer" className="block text-sm font-medium text-gray-700 mb-1">
          Customer Name
        </label>
        <input
          type="text"
          id="customer"
          value={formData.customer}
          onChange={(e) => setFormData({ ...formData, customer: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Company Pty Ltd"
          disabled={isSubmitting}
        />
      </div>
      
      <details className="border border-gray-200 rounded-md p-4">
        <summary className="cursor-pointer font-medium text-gray-700">Additional Fields (Optional)</summary>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="framework" className="block text-sm font-medium text-gray-700 mb-1">
                Framework
              </label>
              <input
                type="text"
                id="framework"
                value={formData.framework}
                onChange={(e) => setFormData({ ...formData, framework: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="NGER"
                disabled={isSubmitting}
              />
            </div>
            
            <div>
              <label htmlFor="version" className="block text-sm font-medium text-gray-700 mb-1">
                Version
              </label>
              <input
                type="text"
                id="version"
                value={formData.version}
                onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="2024"
                disabled={isSubmitting}
              />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="input_type" className="block text-sm font-medium text-gray-700 mb-1">
                Input Type
              </label>
              <input
                type="text"
                id="input_type"
                value={formData.input_type}
                onChange={(e) => setFormData({ ...formData, input_type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="WA - SWIS"
                disabled={isSubmitting}
              />
            </div>
            
            <div>
              <label htmlFor="emissions_factor" className="block text-sm font-medium text-gray-700 mb-1">
                Emissions Factor (tCO2-e)
              </label>
              <input
                type="number"
                step="0.01"
                id="emissions_factor"
                value={formData.emissions_factor || ''}
                onChange={(e) => setFormData({ ...formData, emissions_factor: e.target.value ? parseFloat(e.target.value) : undefined })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.65"
                disabled={isSubmitting}
              />
            </div>
          </div>
        </div>
      </details>
      
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isSubmitting || allMeters.length === 0}
          className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Creating...' : 'Create Invoice'}
        </button>
        
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
