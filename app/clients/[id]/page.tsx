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
  const [fiscalYear, setFiscalYear] = useState(2025);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    fetchClientData();
    fetchFacilities();
    fetchCoverage();
  }, [clientId, fiscalYear]);
  
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
              <Link
                href={`/clients/${clientId}/debug`}
                className="px-4 py-2 border border-red-300 text-red-600 rounded-md hover:bg-red-50 transition-colors text-sm"
                title="Debug database contents"
              >
                🐛 Debug
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
                <div key={facility.id} className="border border-gray-200 rounded-lg p-4">
                  <h3 className="font-medium text-gray-900">{facility.name}</h3>
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
                <option value={2024}>FY 2024 (Jul 23 - Jun 24)</option>
                <option value={2025}>FY 2025 (Jul 24 - Jun 25)</option>
                <option value={2026}>FY 2026 (Jul 25 - Jun 26)</option>
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
    </div>
  );
}
