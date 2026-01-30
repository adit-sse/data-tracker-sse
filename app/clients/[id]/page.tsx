'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import CoverageTable from '@/components/CoverageTable';
import type { Client, MeterWithCoverage } from '@/types';

interface Facility {
  id: string;
  name: string;
  address?: string;
  meterCount: number;
}

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.id as string;
  
  const [client, setClient] = useState<Client | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [metersWithCoverage, setMetersWithCoverage] = useState<MeterWithCoverage[]>([]);
  const [fiscalYears, setFiscalYears] = useState<number[]>([]);
  const [fiscalYear, setFiscalYear] = useState<number>(() => {
    const now = new Date();
    return now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  });
  const [loading, setLoading] = useState(true);
  const [editingFacility, setEditingFacility] = useState<Facility | null>(null);
  const [deletingFacility, setDeletingFacility] = useState<Facility | null>(null);
  
  useEffect(() => {
    fetchClientData();
    fetchFacilities();
    fetchCoverage();
    fetchFiscalYears();
  }, [clientId, fiscalYear]);

  const fetchFiscalYears = async () => {
    try {
      const response = await fetch(`/api/clients/${clientId}/coverage/years`);
      const data = await response.json();
      if (data.fiscalYears && Array.isArray(data.fiscalYears) && data.fiscalYears.length > 0) {
        setFiscalYears(data.fiscalYears);
        // If current selected fiscalYear isn't in the list, set to latest
        if (!data.fiscalYears.includes(fiscalYear)) {
          setFiscalYear(data.fiscalYears[data.fiscalYears.length - 1]);
        }
      } else {
        // Fallback to current FY
        const now = new Date();
        const currentFY = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
        setFiscalYears([currentFY]);
        setFiscalYear(currentFY);
      }
    } catch (error) {
      console.error('Error fetching fiscal years:', error);
    }
  };
  
  const fetchClientData = async () => {
    try {
      const response = await fetch(`/api/clients/${clientId}`);
      const data = await response.json();
      setClient(data);
    } catch (error) {
      console.error('Error fetching client:', error);
    }
  };
  
  const fetchFacilities = async () => {
    try {
      const response = await fetch(`/api/clients/${clientId}/facilities`);
      const data = await response.json();
      setFacilities(data);
    } catch (error) {
      console.error('Error fetching facilities:', error);
    }
  };
  
  const fetchCoverage = async () => {
    try {
      setLoading(true);
      console.log('Fetching coverage for client:', clientId, 'fiscal year:', fiscalYear);
      
      const response = await fetch(`/api/clients/${clientId}/coverage?fiscalYear=${fiscalYear}`);
      const data = await response.json();
      
      console.log('Coverage API response:', data);
      console.log('Meters with coverage:', data.meters?.length || 0);
      
      if (data.meters) {
        data.meters.forEach((m: any, i: number) => {
          console.log(`Meter ${i}:`, m.meter?.lookup1, 'has', m.coverage?.length, 'months');
        });
      }
      
      setMetersWithCoverage(data.meters || []);
    } catch (error) {
      console.error('Error fetching coverage:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleEditFacility = async (name: string, address: string) => {
    if (!editingFacility) return;
    
    try {
      const response = await fetch(`/api/facilities/${editingFacility.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, address })
      });
      
      if (response.ok) {
        setEditingFacility(null);
        fetchFacilities();
      }
    } catch (error) {
      console.error('Error updating facility:', error);
    }
  };
  
  const handleDeleteFacility = async () => {
    if (!deletingFacility) return;
    
    try {
      const response = await fetch(`/api/facilities/${deletingFacility.id}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        setDeletingFacility(null);
        fetchFacilities();
        fetchCoverage(); // Refresh coverage as meters might be affected
      }
    } catch (error) {
      console.error('Error deleting facility:', error);
    }
  };
  
  if (!client) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="text-gray-500 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">{client.name}</h1>
                <p className="mt-1 text-sm text-gray-500">
                  {facilities.length} facilities • {metersWithCoverage.length} meters
                </p>
              </div>
            </div>
            
            <div className="flex gap-3">
              <Link
                href={`/clients/${clientId}/facilities/new`}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                + Add Facility
              </Link>
              <Link
                href={`/clients/${clientId}/meters/new`}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                + Add Meter
              </Link>
              <Link
                href={`/clients/${clientId}/invoices/new`}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                + Add Invoice
              </Link>
              <Link
                href={`/clients/${clientId}/upload`}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
              >
                Upload Invoices
              </Link>
            </div>
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Facilities Section */}
        {facilities.length > 0 && (
          <section className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Facilities</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {facilities.map((facility) => (
                <div key={facility.id} className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-medium text-gray-900">{facility.name}</h3>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setEditingFacility(facility)}
                        className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                        title="Edit facility"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setDeletingFacility(facility)}
                        className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                        title="Delete facility"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {facility.address && (
                    <p className="text-sm text-gray-500 mt-1">{facility.address}</p>
                  )}
                  <p className="text-sm text-gray-600 mt-2">
                    {facility.meterCount} {facility.meterCount === 1 ? 'meter' : 'meters'}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
        
        {/* Coverage Dashboard */}
        <section>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Coverage Dashboard</h2>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Fiscal Year:</label>
              <select
                value={fiscalYear}
                onChange={(e) => setFiscalYear(parseInt(e.target.value))}
                className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {fiscalYears.map((fy) => (
                  <option key={fy} value={fy}>
                    {`FY ${fy} (Jul ${String(fy - 1).slice(-2)} - Jun ${String(fy).slice(-2)})`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          
          {loading ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading coverage data...</p>
            </div>
          ) : (
            <CoverageTable 
              metersWithCoverage={metersWithCoverage} 
              fiscalYear={fiscalYear}
            />
          )}
        </section>
      </main>
      
      {/* Edit Facility Modal */}
      {editingFacility && (
        <EditFacilityModal
          facility={editingFacility}
          onSave={handleEditFacility}
          onCancel={() => setEditingFacility(null)}
        />
      )}
      
      {/* Delete Facility Modal */}
      {deletingFacility && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-semibold mb-4 text-red-600">Delete Facility</h2>
            <p className="text-gray-700 mb-2">
              Are you sure you want to delete <strong>{deletingFacility.name}</strong>?
            </p>
            <p className="text-sm text-gray-600 mb-4">
              This will also delete all {deletingFacility.meterCount} associated meter(s) and their invoices. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDeleteFacility}
                className="flex-1 bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
              >
                Delete
              </button>
              <button
                onClick={() => setDeletingFacility(null)}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}

// Edit Facility Modal Component
function EditFacilityModal({ 
  facility, 
  onSave, 
  onCancel 
}: { 
  facility: Facility; 
  onSave: (name: string, address: string) => void; 
  onCancel: () => void;
}) {
  const [name, setName] = useState(facility.name);
  const [address, setAddress] = useState(facility.address || '');
  const [saving, setSaving] = useState(false);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave(name, address);
    setSaving(false);
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h2 className="text-xl font-semibold mb-4">Edit Facility</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="facilityName" className="block text-sm font-medium text-gray-700 mb-1">
              Facility Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="facilityName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              autoFocus
            />
          </div>
          <div className="mb-4">
            <label htmlFor="facilityAddress" className="block text-sm font-medium text-gray-700 mb-1">
              Address
            </label>
            <input
              type="text"
              id="facilityAddress"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
