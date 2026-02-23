'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import CoverageTable from '@/components/CoverageTable';
import CoverageSummary from '@/components/CoverageSummary';
import FacilitySettingsModal from '@/components/FacilitySettingsModal';
import InvoiceForm, { InvoiceFormData } from '@/components/InvoiceForm';
import type { Client, MeterWithCoverage, ActualInvoice } from '@/types';

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
  const [settingsFacility, setSettingsFacility] = useState<Facility | null>(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [invoiceInitialData, setInvoiceInitialData] = useState<any | null>(null);
  const [invoiceInitialFacilityId, setInvoiceInitialFacilityId] = useState<string | null>(null);
  const [invoiceListModalOpen, setInvoiceListModalOpen] = useState(false);
  const [invoiceListForPeriod, setInvoiceListForPeriod] = useState<ActualInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    fetchClientData();
    fetchFacilities();
    fetchCoverage();
    fetchFiscalYears();
  }, [clientId, fiscalYear]);

  const fetchFiscalYears = async () => {
    try {
      const response = await fetch(`/api/clients/${clientId}/coverage/years`);
      if (!response.ok) return;
      const data = await response.json();
      if (data.fiscalYears && Array.isArray(data.fiscalYears) && data.fiscalYears.length > 0) {
        setFiscalYears(data.fiscalYears);
        if (!data.fiscalYears.includes(fiscalYear)) {
          setFiscalYear(data.fiscalYears[data.fiscalYears.length - 1]);
        }
      } else {
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
      if (!response.ok) {
        setError('Failed to load client');
        return;
      }
      const data = await response.json();
      setClient(data);
      setError(null);
    } catch (error) {
      console.error('Error fetching client:', error);
      setError('Failed to load client');
    }
  };
  
  const fetchFacilities = async () => {
    try {
      const response = await fetch(`/api/clients/${clientId}/facilities`);
      if (!response.ok) return;
      const data = await response.json();
      setFacilities(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching facilities:', error);
    }
  };
  
  const fetchCoverage = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/clients/${clientId}/coverage?fiscalYear=${fiscalYear}`);
      if (!response.ok) {
        setMetersWithCoverage([]);
        return;
      }
      const data = await response.json();
      setMetersWithCoverage(data.meters || []);
    } catch (error) {
      console.error('Error fetching coverage:', error);
      setMetersWithCoverage([]);
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
        fetchCoverage();
      }
    } catch (error) {
      console.error('Error deleting facility:', error);
    }
  };
  
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12A9 9 0 113 12a9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900">{error}</h3>
          <div className="mt-6 flex gap-3 justify-center">
            <button
              onClick={() => { setError(null); fetchClientData(); }}
              className="bg-emerald-600 text-white px-5 py-2.5 rounded-lg hover:bg-emerald-700 font-medium transition-colors"
            >
              Try Again
            </button>
            <Link href="/" className="px-5 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors">
              Go Back
            </Link>
          </div>
        </div>
      </div>
    );
  }
  
  if (!client) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-16 h-16 mx-auto">
            <div className="absolute inset-0 rounded-full border-4 border-emerald-100"></div>
            <div className="absolute inset-0 rounded-full border-4 border-emerald-600 border-t-transparent animate-spin"></div>
          </div>
          <p className="mt-4 text-gray-500 font-medium">Loading...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div className="w-px h-6 bg-gray-200" />
              <div>
                <h1 className="text-xl font-bold text-gray-900">{client.name}</h1>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Link
                href={`/clients/${clientId}/facilities/new`}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Facility
              </Link>
              <Link
                href={`/clients/${clientId}/meters/new`}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Meter
              </Link>
              <Link
                href={`/clients/${clientId}/invoices/new`}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Invoice
              </Link>
              <div className="w-px h-6 bg-gray-200 mx-1" />
              <Link
                href={`/clients/${clientId}/upload`}
                className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors font-medium text-sm flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span className="hidden sm:inline">Upload</span>
              </Link>
            </div>
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">{facilities.length}</div>
                <div className="text-xs text-gray-500">Facilities</div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">{metersWithCoverage.length}</div>
                <div className="text-xs text-gray-500">Meters</div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm col-span-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-violet-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">Fiscal Year</div>
                  <div className="text-xs text-gray-500">Select period</div>
                </div>
              </div>
              <select
                value={fiscalYear}
                onChange={(e) => setFiscalYear(parseInt(e.target.value))}
                className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              >
                {fiscalYears.map((fy) => (
                  <option key={fy} value={fy}>
                    {`FY ${fy} (Jul ${String(fy - 1).slice(-2)} - Jun ${String(fy).slice(-2)})`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Facilities Section */}
        {facilities.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Facilities</h2>
              <Link
                href={`/clients/${clientId}/facilities/new`}
                className="text-sm text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {facilities.map((facility) => (
                <div key={facility.id} className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 transition-all p-4 group">
                  <div className="flex justify-between items-start">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-bold text-emerald-600">{facility.name.charAt(0).toUpperCase()}</span>
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">{facility.name}</h3>
                        {facility.address && (
                          <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{facility.address}</p>
                        )}
                        <div className="flex items-center gap-1.5 mt-2">
                          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <span className="text-sm text-gray-500">{facility.meterCount} {facility.meterCount === 1 ? 'meter' : 'meters'}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSettingsFacility(facility); }}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        
        {/* Coverage Dashboard */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Coverage Dashboard</h2>
          </div>
          
          {loading ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
              <div className="relative w-12 h-12 mx-auto">
                <div className="absolute inset-0 rounded-full border-4 border-emerald-100"></div>
                <div className="absolute inset-0 rounded-full border-4 border-emerald-600 border-t-transparent animate-spin"></div>
              </div>
              <p className="mt-4 text-gray-500">Loading coverage data...</p>
            </div>
          ) : (
            <>
              <CoverageSummary metersWithCoverage={metersWithCoverage} />
              <CoverageTable 
                metersWithCoverage={metersWithCoverage} 
                fiscalYear={fiscalYear}
                onQuickAddInvoice={({ meterId, facilityId, period_start_date, period_end_date, invoices }) => {
                  if (invoices && invoices.length > 0) {
                    setInvoiceListForPeriod(invoices);
                    setInvoiceListModalOpen(true);
                  } else {
                    setInvoiceModalOpen(true);
                    setInvoiceInitialData({ meter_id: String(meterId), period_start_date, period_end_date });
                    setInvoiceInitialFacilityId(facilityId ? String(facilityId) : '');
                  }
                }}
              />
            </>
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

      {/* Invoice List Modal */}
      {invoiceListModalOpen && invoiceListForPeriod && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-gray-900">Invoices for Period</h2>
              <button 
                onClick={() => { setInvoiceListModalOpen(false); setInvoiceListForPeriod(null); }} 
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-3">
              {invoiceListForPeriod.map(inv => (
                <div key={inv.id} className="border border-gray-100 rounded-lg p-4 flex items-center justify-between hover:border-gray-200 transition-colors">
                  <div>
                    <div className="font-medium text-gray-900">{inv.invoice_number || 'No invoice number'}</div>
                    <div className="text-sm text-gray-500 mt-1">{inv.period_start_date} → {inv.period_end_date} • ${inv.amount ?? '—'}</div>
                    <div className="text-sm text-gray-400 mt-0.5">Meter: {inv.meter?.lookup1 || String(inv.meter_id)}</div>
                  </div>
                  <button
                    onClick={() => {
                      setInvoiceInitialData({ ...inv });
                      setInvoiceInitialFacilityId(inv.meter?.facility_id ? String(inv.meter.facility_id) : '');
                      setInvoiceListModalOpen(false);
                      setInvoiceListForPeriod(null);
                      setInvoiceModalOpen(true);
                    }}
                    className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Edit
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  const first = invoiceListForPeriod[0];
                  setInvoiceInitialData({ meter_id: String(first.meter_id), period_start_date: first.period_start_date, period_end_date: first.period_end_date });
                  setInvoiceInitialFacilityId(first.meter?.facility_id ? String(first.meter.facility_id) : '');
                  setInvoiceListModalOpen(false);
                  setInvoiceListForPeriod(null);
                  setInvoiceModalOpen(true);
                }}
                className="w-full bg-emerald-600 text-white px-4 py-2.5 rounded-lg hover:bg-emerald-700 font-medium transition-colors"
              >
                Add New Invoice for Period
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Add / Edit Invoice Modal */}
      {invoiceModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-gray-900">{invoiceInitialData?.id ? 'Edit Invoice' : 'Add Invoice'}</h2>
              <button 
                onClick={() => setInvoiceModalOpen(false)} 
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <InvoiceForm
              clientId={clientId}
              initialData={invoiceInitialData}
              initialFacilityId={invoiceInitialFacilityId ?? undefined}
              onSubmit={async (data) => {
                try {
                  if (data.id) {
                    const res = await fetch(`/api/clients/${clientId}/invoices/${data.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(data)
                    });
                    if (!res.ok) {
                      const err = await res.json();
                      throw new Error(err.error || 'Failed to update invoice');
                    }
                  } else {
                    const res = await fetch(`/api/clients/${clientId}/invoices`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(data)
                    });
                    if (!res.ok) {
                      const err = await res.json();
                      throw new Error(err.error || 'Failed to create invoice');
                    }
                  }
                  setInvoiceModalOpen(false);
                  setInvoiceInitialData(null);
                  setInvoiceInitialFacilityId(null);
                  fetchCoverage();
                  fetchFacilities();
                } catch (err) {
                  throw err;
                }
              }}
              onCancel={() => setInvoiceModalOpen(false)}
            />
          </div>
        </div>
      )}
      
      {/* Facility Settings Modal */}
      {settingsFacility && (
        <FacilitySettingsModal
          facility={settingsFacility}
          clientId={clientId}
          onClose={() => setSettingsFacility(null)}
          onFacilityDeleted={() => { setSettingsFacility(null); fetchFacilities(); fetchCoverage(); }}
          onFacilityUpdated={() => { fetchFacilities(); fetchCoverage(); }}
        />
      )}

      {/* Delete Facility Modal */}
      {deletingFacility && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900">Delete Facility</h2>
            </div>
            <p className="text-gray-600 mb-2">
              Are you sure you want to delete <span className="font-medium text-gray-900">{deletingFacility.name}</span>?
            </p>
            <p className="text-sm text-gray-500 mb-5">
              This will also delete {deletingFacility.meterCount} meter(s) and their invoices.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeletingFacility(null)}
                className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteFacility}
                className="flex-1 bg-red-600 text-white px-4 py-2.5 rounded-lg hover:bg-red-700 font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-semibold text-gray-900">Edit Facility</h2>
          <button
            onClick={onCancel}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="facilityName" className="block text-sm font-medium text-gray-700 mb-1.5">
              Facility Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="facilityName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              required
              autoFocus
            />
          </div>
          <div className="mb-5">
            <label htmlFor="facilityAddress" className="block text-sm font-medium text-gray-700 mb-1.5">
              Address
            </label>
            <input
              type="text"
              id="facilityAddress"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              placeholder="Optional"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-emerald-600 text-white px-4 py-2.5 rounded-lg hover:bg-emerald-700 font-medium transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
