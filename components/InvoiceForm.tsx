'use client';

import { useState, useEffect } from 'react';
import DatePicker from './DatePicker';

interface InvoiceFormProps {
  clientId: string;
  onSubmit: (data: InvoiceFormData) => Promise<void>;
  onCancel?: () => void;
  initialData?: Partial<InvoiceFormData>;
  initialFacilityId?: string;
}

export interface InvoiceFormData {
  id?: string;
  meter_id: string;
  period_start_date: string;
  period_end_date: string;
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
  input_type?: { name: string } | null;
  /** @deprecated use input_type */
  utility_category?: { name: string } | null;
  supplier?: { name: string } | null;
}

export default function InvoiceForm({ clientId, onSubmit, onCancel, initialData, initialFacilityId }: InvoiceFormProps) {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [allMeters, setAllMeters] = useState<Meter[]>([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState('');
  const [filteredMeters, setFilteredMeters] = useState<Meter[]>([]);
  
  // Helper functions for date handling
  const formatLocalDate = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  const getCurrentMonthStart = () => {
    const now = new Date();
    return formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1));
  };
  
  const getCurrentMonthEnd = () => {
    const now = new Date();
    return formatLocalDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  };
  
  const getMonthStart = (year: number, month: number) => {
    return formatLocalDate(new Date(year, month, 1));
  };
  
  const getMonthEnd = (year: number, month: number) => {
    return formatLocalDate(new Date(year, month + 1, 0));
  };
  
  const [formData, setFormData] = useState<InvoiceFormData>({
    meter_id: '',
    period_start_date: getCurrentMonthStart(),
    period_end_date: getCurrentMonthEnd(),
  });

  // If initialData is provided (e.g., quick-add from coverage pill), prefill form when meters are loaded
  useEffect(() => {
    if (!initialData && !initialFacilityId) return;

    // If initial meter is provided and we already loaded meters, set meter and facility
    if (initialData?.meter_id && allMeters.length > 0) {
      const matched = allMeters.find(m => String(m.id) === String(initialData.meter_id));
      if (matched) {
        setSelectedFacilityId(String(matched.facility_id));
      }
      setFormData(prev => ({ ...prev, ...initialData } as InvoiceFormData));
    } else {
      // Apply initial facility if provided
      if (initialFacilityId) {
        setSelectedFacilityId(initialFacilityId);
      }
      // Apply initial data even if meters not loaded yet
      if (initialData) {
        setFormData(prev => ({ ...prev, ...initialData } as InvoiceFormData));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, initialFacilityId, allMeters]);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  useEffect(() => {
    let cancelled = false;
    
    const fetchData = async () => {
      try {
        const [facilitiesRes, metersRes] = await Promise.all([
          fetch(`/api/clients/${clientId}/facilities`),
          fetch(`/api/clients/${clientId}/meters`)
        ]);
        
        if (cancelled) return;
        
        if (!facilitiesRes.ok) {
          throw new Error('Failed to fetch facilities');
        }
        if (!metersRes.ok) {
          throw new Error('Failed to fetch meters');
        }
        
        const [facilitiesData, metersData] = await Promise.all([
          facilitiesRes.json(),
          metersRes.json()
        ]);
        
        if (cancelled) return;
        
        setFacilities(facilitiesData);
        setAllMeters(metersData);
        setFilteredMeters(metersData);
      } catch (err) {
        if (!cancelled) {
          console.error('Error fetching data:', err);
          setError(err instanceof Error ? err.message : 'Failed to load facilities and meters');
        }
      }
    };
    
    fetchData();
    
    return () => {
      cancelled = true;
    };
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

  // Auto-update period_end_date when period_start_date changes (only for new invoices).
  // - If start is the 1st of the month -> set end to last day of that same month.
  // - Otherwise -> default to the same day one calendar month later (clamped to month's last day).
  // Skip this logic when editing an existing invoice to preserve the original dates.
  useEffect(() => {
    // Don't auto-update end date when editing an existing invoice
    if (initialData?.id) return;
    
    const startStr = formData.period_start_date;
    if (!startStr) return;
    const start = new Date(startStr);
    if (isNaN(start.getTime())) return;

    const year = start.getFullYear();
    const month = start.getMonth();
    const day = start.getDate();

    let end: Date;
    if (day === 1) {
      // Last day of the same month
      end = new Date(year, month + 1, 0);
    } else {
      // Same day next month, clamp to last day if necessary
      const nextMonth = month + 1;
      const lastDayNextMonth = new Date(year, nextMonth + 1, 0).getDate();
      const dayToUse = Math.min(day, lastDayNextMonth);
      end = new Date(year, nextMonth, dayToUse);
    }

    const formattedEnd = formatLocalDate(end);

    // Only update if different to avoid unnecessary re-renders
    if (formattedEnd !== formData.period_end_date) {
      setFormData(prev => ({ ...prev, period_end_date: formattedEnd } as InvoiceFormData));
    }
  // Intentionally only watch the start date string
  }, [formData.period_start_date, initialData?.id]);
  
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
      
      // Only reset form when creating new invoice, not when editing
      if (!initialData?.id) {
        setFormData({
          meter_id: '',
          period_start_date: getCurrentMonthStart(),
          period_end_date: getCurrentMonthEnd(),
        });
        setSelectedFacilityId('');
      }
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
              {(meter.input_type || meter.utility_category)?.name || 'N/A'} - {meter.supplier?.name || 'No Supplier'} • {meter.lookup1}
            </option>
          ))}
        </select>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <DatePicker
          value={formData.period_start_date}
          onChange={(date) => setFormData({ ...formData, period_start_date: date })}
          label="Period Start Date"
          required
          disabled={isSubmitting}
        />
        
        <DatePicker
          value={formData.period_end_date}
          onChange={(date) => setFormData({ ...formData, period_end_date: date })}
          label="Period End Date"
          required
          disabled={isSubmitting}
          initialViewDate={formData.period_start_date}
        />
      </div>
      
      
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isSubmitting || allMeters.length === 0}
          className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? (initialData?.id ? 'Saving...' : 'Creating...') : (initialData?.id ? 'Save Changes' : 'Create Invoice')}
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