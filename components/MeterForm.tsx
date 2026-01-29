'use client';

import { useState, useEffect } from 'react';

interface MeterFormProps {
  clientId: string;
  onSubmit: (data: MeterFormData) => Promise<void>;
  onCancel?: () => void;
}

export interface MeterFormData {
  facility_id: string;
  supplier_id: string;
  utility_category_id: string;
  identifier_type: string;
  lookup1: string;
  lookup2?: string;
}

interface Facility {
  id: string;
  name: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface UtilityCategory {
  id: string;
  name: string;
}

export default function MeterForm({ clientId, onSubmit, onCancel }: MeterFormProps) {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [utilityCategories, setUtilityCategories] = useState<UtilityCategory[]>([]);
  
  const [formData, setFormData] = useState<MeterFormData>({
    facility_id: '',
    supplier_id: '',
    utility_category_id: '',
    identifier_type: 'NMI',
    lookup1: '',
    lookup2: ''
  });
  
  const [newSupplierName, setNewSupplierName] = useState('');
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  useEffect(() => {
    fetchData();
  }, [clientId]);
  
  const fetchData = async () => {
    try {
      // Fetch facilities
      const facilitiesRes = await fetch(`/api/clients/${clientId}/facilities`);
      const facilitiesData = await facilitiesRes.json();
      setFacilities(facilitiesData);
      
      // Fetch utility categories
      const categoriesRes = await fetch('/api/utility-categories');
      const categoriesData = await categoriesRes.json();
      setUtilityCategories(categoriesData);
      
      // Fetch suppliers
      const suppliersRes = await fetch('/api/suppliers');
      const suppliersData = await suppliersRes.json();
      setSuppliers(suppliersData);
    } catch (err) {
      console.error('Error fetching data:', err);
    }
  };
  
  const handleCreateSupplier = async () => {
    if (!newSupplierName.trim()) return;
    
    try {
      const response = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newSupplierName.trim() })
      });
      
      const newSupplier = await response.json();
      setSuppliers([...suppliers, newSupplier]);
      setFormData({ ...formData, supplier_id: newSupplier.id });
      setNewSupplierName('');
      setShowNewSupplier(false);
    } catch (err) {
      setError('Failed to create supplier');
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    // Supplier is now optional
    if (!formData.facility_id || !formData.utility_category_id || !formData.lookup1) {
      setError('Please fill in facility, utility type, and meter identifier');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      console.log('Submitting meter data:', formData);
      await onSubmit(formData);
      
      // Reset form
      setFormData({
        facility_id: '',
        supplier_id: '',
        utility_category_id: '',
        identifier_type: 'NMI',
        lookup1: '',
        lookup2: ''
      });
    } catch (err) {
      console.error('Form submission error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to create meter';
      setError(errorMessage);
      
      // Don't close the form on error - let user fix it
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const identifierTypes = [
    { value: 'NMI', label: 'NMI (National Meter Identifier)' },
    { value: 'ACCOUNT_NUMBER', label: 'Account Number' },
    { value: 'METER_NUMBER', label: 'Meter Number' },
    { value: 'REGISTRATION_PLATE', label: 'Registration Plate' },
    { value: 'CARD_NUMBER', label: 'Card Number' },
    { value: 'FACILITY_LEVEL', label: 'Facility Level' }
  ];
  
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}
      
      <div>
        <label htmlFor="facility" className="block text-sm font-medium text-gray-700 mb-1">
          Facility <span className="text-red-500">*</span>
        </label>
        <select
          id="facility"
          value={formData.facility_id}
          onChange={(e) => setFormData({ ...formData, facility_id: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
          disabled={isSubmitting}
        >
          <option value="">Select a facility</option>
          {facilities.map(facility => (
            <option key={facility.id} value={facility.id}>{facility.name}</option>
          ))}
        </select>
      </div>
      
      <div>
        <label htmlFor="utility_category" className="block text-sm font-medium text-gray-700 mb-1">
          Utility Type <span className="text-red-500">*</span>
        </label>
        <select
          id="utility_category"
          value={formData.utility_category_id}
          onChange={(e) => setFormData({ ...formData, utility_category_id: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
          disabled={isSubmitting}
        >
          <option value="">Select utility type</option>
          {utilityCategories.map(category => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
      </div>
      
      <div>
        <div className="flex justify-between items-center mb-1">
          <label htmlFor="supplier" className="block text-sm font-medium text-gray-700">
            Supplier <span className="text-gray-400 text-xs">(Optional)</span>
          </label>
          <button
            type="button"
            onClick={() => setShowNewSupplier(!showNewSupplier)}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            {showNewSupplier ? 'Cancel' : '+ New Supplier'}
          </button>
        </div>
        
        {showNewSupplier ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={newSupplierName}
              onChange={(e) => setNewSupplierName(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter supplier name"
            />
            <button
              type="button"
              onClick={handleCreateSupplier}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Add
            </button>
          </div>
        ) : (
          <select
            id="supplier"
            value={formData.supplier_id}
            onChange={(e) => setFormData({ ...formData, supplier_id: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isSubmitting}
          >
            <option value="">No supplier (can add later)</option>
            {suppliers.map(supplier => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </select>
        )}
      </div>
      
      <div>
        <label htmlFor="identifier_type" className="block text-sm font-medium text-gray-700 mb-1">
          Identifier Type <span className="text-red-500">*</span>
        </label>
        <select
          id="identifier_type"
          value={formData.identifier_type}
          onChange={(e) => setFormData({ ...formData, identifier_type: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
          disabled={isSubmitting}
        >
          {identifierTypes.map(type => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
      </div>
      
      <div>
        <label htmlFor="lookup1" className="block text-sm font-medium text-gray-700 mb-1">
          Meter Identifier <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          id="lookup1"
          value={formData.lookup1}
          onChange={(e) => setFormData({ ...formData, lookup1: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g., 1234567890 (NMI), ACC123456 (Account Number)"
          required
          disabled={isSubmitting}
        />
      </div>
      
      <div>
        <label htmlFor="lookup2" className="block text-sm font-medium text-gray-700 mb-1">
          Secondary Identifier (Optional)
        </label>
        <input
          type="text"
          id="lookup2"
          value={formData.lookup2}
          onChange={(e) => setFormData({ ...formData, lookup2: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g., WA - SWIS, LPG"
          disabled={isSubmitting}
        />
      </div>
      
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Creating...' : 'Create Meter'}
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
