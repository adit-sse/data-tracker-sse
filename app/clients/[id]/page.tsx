'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import CoverageTable from '@/components/CoverageTable';
import CoverageSummary from '@/components/CoverageSummary';
import NonMeteredCoverageTable from '@/components/NonMeteredCoverageTable';
import FacilitySettingsModal from '@/components/FacilitySettingsModal';
import InvoiceForm, { InvoiceFormData } from '@/components/InvoiceForm';
import FacilityForm from '@/components/FacilityForm';
import MeterForm, { MeterFormData } from '@/components/MeterForm';
import FileUpload from '@/components/FileUpload';
import ConfirmModal from '@/components/ConfirmModal';
import FacilityGroupManager from '@/components/FacilityGroupManager';
import NeedsReviewBanner from '@/components/NeedsReviewBanner';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type {
  Client,
  MeterWithCoverage,
  ActualInvoice,
  UploadResult,
  NonMeteredRowWithCoverage,
  NonMeteredMonthlyCoverage,
  NonMeteredRecord,
} from '@/types';

type ScopeTab = 'scope1-non-metered' | 'scope1-metered' |  'scope2' | 'scope3';

interface Facility {
  id: string;
  name: string;
  address?: string;
  meterCount: number;
}

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientId = params.id as string;

  const [client, setClient] = useState<Client | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [metersWithCoverage, setMetersWithCoverage] = useState<MeterWithCoverage[]>([]);
  const [nonMeteredRows, setNonMeteredRows] = useState<NonMeteredRowWithCoverage[]>([]);
  const [scope3Rows, setScope3Rows] = useState<NonMeteredRowWithCoverage[]>([]);
  const [fiscalYears, setFiscalYears] = useState<number[]>([]);
  const [fiscalYear, setFiscalYear] = useState<number>(() => {
    const now = new Date();
    return now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ScopeTab>(() => {
    const tab = searchParams.get('tab');
    if (tab === 'scope1-metered' || tab === 'scope1-non-metered' || tab === 'scope3') return tab;
    return 'scope2';
  });

  const [settingsFacility, setSettingsFacility] = useState<Facility | null>(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [invoiceInitialData, setInvoiceInitialData] = useState<any | null>(null);
  const [invoiceInitialFacilityId, setInvoiceInitialFacilityId] = useState<string | null>(null);
  const [invoiceListModalOpen, setInvoiceListModalOpen] = useState(false);
  const [invoiceListForPeriod, setInvoiceListForPeriod] = useState<ActualInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [addFacilityModalOpen, setAddFacilityModalOpen] = useState(false);
  const [addMeterModalOpen, setAddMeterModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProcessing, setUploadProcessing] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);

  const [facilitySearch, setFacilitySearch] = useState('');
  const [showAllFacilities, setShowAllFacilities] = useState(false);
  const FACILITY_PREVIEW_LIMIT = 3;

  const [deletingInvoice, setDeletingInvoice] = useState<ActualInvoice | null>(null);
  const [deletingInvoiceLoading, setDeletingInvoiceLoading] = useState(false);
  const [deletingInvoiceError, setDeletingInvoiceError] = useState<string | null>(null);

  // Non-metered record detail modal
  const [nmRecordModal, setNmRecordModal] = useState<NonMeteredRecord | null>(null);

  // Non-metered empty cell "mark as received" modal
  const [nmMarkEmptyModal, setNmMarkEmptyModal] = useState<{
    row: NonMeteredRowWithCoverage;
    cell: NonMeteredMonthlyCoverage;
  } | null>(null);

  useEffect(() => {
    // Persist active tab in URL
    const current = searchParams.get('tab');
    if (current !== activeTab) {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', activeTab);
      router.replace(url.pathname + url.search, { scroll: false });
    }
  }, [activeTab]);

  useEffect(() => {
    Promise.all([
      fetchClientData(),
      fetchFacilities(),
      fetchCoverage(true),
      fetchNonMeteredCoverage(),
      fetchFiscalYears(),
    ]);
  }, [clientId, fiscalYear]);

  const fetchFiscalYears = async () => {
    try {
      const response = await fetch(`/api/clients/${clientId}/coverage/years`);
      if (!response.ok) return;
      const data = await response.json();
      if (data.fiscalYears?.length > 0) {
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
      if (!response.ok) { setError('Failed to load client'); return; }
      const data = await response.json();
      setClient(data);
      setError(null);
    } catch {
      setError('Failed to load client');
    }
  };

  const fetchFacilities = async () => {
    try {
      const response = await fetch(`/api/clients/${clientId}/facilities`);
      if (!response.ok) return;
      const data = await response.json();
      setFacilities(Array.isArray(data) ? data : []);
    } catch {}
  };

  const fetchCoverage = async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const response = await fetch(`/api/clients/${clientId}/coverage?fiscalYear=${fiscalYear}`);
      if (!response.ok) { setMetersWithCoverage([]); return; }
      const data = await response.json();
      setMetersWithCoverage(data.meters || []);
    } catch {
      setMetersWithCoverage([]);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const fetchNonMeteredCoverage = async () => {
    try {
      const [scope1Res, scope3Res] = await Promise.all([
        fetch(`/api/clients/${clientId}/coverage/non-metered?fiscalYear=${fiscalYear}&scope=1`),
        fetch(`/api/clients/${clientId}/coverage/non-metered?fiscalYear=${fiscalYear}&scope=3`),
      ]);
      const scope1Data = scope1Res.ok ? await scope1Res.json() : { rows: [] };
      const scope3Data = scope3Res.ok ? await scope3Res.json() : { rows: [] };
      setNonMeteredRows(scope1Data.rows || []);
      setScope3Rows(scope3Data.rows || []);
    } catch {
      setNonMeteredRows([]);
      setScope3Rows([]);
    }
  };

  /**
   * Applies a single-row patch to local state using the PATCH response,
   * avoiding a full coverage refetch for simple metadata updates.
   */
  const applyNonMeteredLineUpdate = (
    lineId: string,
    updated: {
      category?: { id: string; name: string } | null;
      input_type?: { id: string; name: string } | null;
      is_active?: boolean;
    },
  ) => {
    const patchRow = (row: NonMeteredRowWithCoverage): NonMeteredRowWithCoverage => {
      if (row.lineId !== lineId) return row;
      return {
        ...row,
        ...(updated.category !== undefined && {
          categoryId: updated.category?.id ?? null,
          categoryName: updated.category?.name ?? null,
        }),
        ...(updated.input_type !== undefined && {
          inputTypeId: updated.input_type?.id ?? row.inputTypeId,
          inputTypeName: updated.input_type?.name ?? row.inputTypeName,
        }),
        ...(updated.is_active !== undefined && { isActive: updated.is_active }),
      };
    };
    setNonMeteredRows((prev) => prev.map(patchRow));
    setScope3Rows((prev) => prev.map(patchRow));
  };

  // Filter metered coverage by scope
  const scope2Meters = metersWithCoverage.filter(
    (m) => (m.meter.input_type as any)?.scope === 2
  );
  const scope1MeteredMeters = metersWithCoverage.filter(
    (m) =>
      (m.meter.input_type as any)?.scope === 1 &&
      (m.meter.input_type as any)?.is_metered === true
  );

  const handleTabChange = (tab: ScopeTab) => {
    setActiveTab(tab);
  };

  const refreshAll = () => {
    fetchFacilities();
    fetchCoverage();
    fetchNonMeteredCoverage();
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
            <button onClick={() => { setError(null); fetchClientData(); }} className="bg-emerald-600 text-white px-5 py-2.5 rounded-lg hover:bg-emerald-700 font-medium transition-colors">
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
        <div className="mx-auto px-4 sm:px-6 lg:px-10 max-w-[1600px]">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Link href="/" className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div className="w-px h-6 bg-gray-200" />
              <h1 className="text-xl font-bold text-gray-900">{client.name}</h1>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setAddFacilityModalOpen(true)}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Facility
              </button>
              <button
                onClick={() => setAddMeterModalOpen(true)}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Meter
              </button>
              <button
                onClick={() => { setInvoiceInitialData(null); setInvoiceInitialFacilityId(null); setInvoiceModalOpen(true); }}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Invoice
              </button>
              <button
                onClick={() => setGroupManagerOpen(true)}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
                title="Manage facility groups for non-metered inference"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Groups
              </button>
              <div className="w-px h-6 bg-gray-200 mx-1" />
              <button
                type="button"
                onClick={async () => {
                  const supabase = createSupabaseBrowserClient();
                  await supabase.auth.signOut();
                  router.push('/login');
                  router.refresh();
                }}
                className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Sign out
              </button>
              <button
                onClick={() => { setUploadFile(null); setUploadResult(null); setUploadProcessing(false); setUploadModalOpen(true); }}
                className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors font-medium text-sm flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span className="hidden sm:inline">Upload</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-500" />

      <main className="mx-auto px-4 sm:px-6 lg:px-10 max-w-[1600px] py-8 space-y-6">
        {/* Needs-review banner */}
        <NeedsReviewBanner />

        {/* Facilities Section */}
        {facilities.length > 0 && (() => {
          const searchTerm = facilitySearch.toLowerCase();
          const filtered = searchTerm
            ? facilities.filter(f =>
                f.name.toLowerCase().includes(searchTerm) ||
                (f.address && f.address.toLowerCase().includes(searchTerm))
              )
            : facilities;
          const isExpanded = showAllFacilities || searchTerm.length > 0;
          const visible = isExpanded ? filtered : filtered.slice(0, FACILITY_PREVIEW_LIMIT);
          const hiddenCount = filtered.length - visible.length;

          return (
            <section>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">Facilities</h2>
                  <span className="text-sm text-gray-400">({facilities.length})</span>
                </div>
                <div className="flex items-center gap-2">
                  {facilities.length > FACILITY_PREVIEW_LIMIT && (
                    <div className="relative">
                      <svg className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <input
                        type="text"
                        placeholder="Search facilities..."
                        value={facilitySearch}
                        onChange={(e) => setFacilitySearch(e.target.value)}
                        className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent w-48"
                      />
                      {facilitySearch && (
                        <button
                          onClick={() => setFacilitySearch('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => setAddFacilityModalOpen(true)}
                    className="text-sm text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1.5 px-3 py-1.5 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Facility
                  </button>
                </div>
              </div>

              {searchTerm && filtered.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-100 p-6 text-center">
                  <p className="text-sm text-gray-500">No facilities matching &ldquo;{facilitySearch}&rdquo;</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {visible.map((facility) => (
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

                  {!searchTerm && hiddenCount > 0 && !showAllFacilities && (
                    <button
                      onClick={() => setShowAllFacilities(true)}
                      className="mt-3 w-full py-2 text-sm font-medium text-emerald-600 hover:text-emerald-700 bg-emerald-50/50 hover:bg-emerald-50 border border-emerald-100 rounded-lg transition-colors"
                    >
                      View all {facilities.length} facilities
                    </button>
                  )}
                  {!searchTerm && showAllFacilities && facilities.length > FACILITY_PREVIEW_LIMIT && (
                    <button
                      onClick={() => setShowAllFacilities(false)}
                      className="mt-3 w-full py-2 text-sm font-medium text-gray-500 hover:text-gray-700 bg-gray-50/50 hover:bg-gray-50 border border-gray-100 rounded-lg transition-colors"
                    >
                      Show less
                    </button>
                  )}
                </>
              )}
            </section>
          );
        })()}

        {/* Coverage Dashboard */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Coverage Dashboard</h2>
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <select
                value={fiscalYear}
                onChange={(e) => setFiscalYear(parseInt(e.target.value))}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              >
                {fiscalYears.map((fy) => (
                  <option key={fy} value={fy}>
                    {`FY ${fy} (Jul ${String(fy - 1).slice(-2)} - Jun ${String(fy).slice(-2)})`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Scope tabs */}
          <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
            <TabButton active={activeTab === 'scope1-metered'} onClick={() => handleTabChange('scope1-metered')}>
              Scope 1 — Gas
              {scope1MeteredMeters.length > 0 && (
                <span className="ml-1.5 text-xs bg-white/60 rounded px-1.5 py-0.5">{scope1MeteredMeters.length}</span>
              )}
            </TabButton>
            <TabButton active={activeTab === 'scope1-non-metered'} onClick={() => handleTabChange('scope1-non-metered')}>
              Scope 1 — Non-Metered
              {nonMeteredRows.length > 0 && (
                <span className="ml-1.5 text-xs bg-white/60 rounded px-1.5 py-0.5">{nonMeteredRows.length}</span>
              )}
            </TabButton>
            <TabButton active={activeTab === 'scope2'} onClick={() => handleTabChange('scope2')}>
              Scope 2 — Electricity
              {scope2Meters.length > 0 && (
                <span className="ml-1.5 text-xs bg-white/60 rounded px-1.5 py-0.5">{scope2Meters.length}</span>
              )}
            </TabButton>
            <TabButton active={activeTab === 'scope3'} onClick={() => handleTabChange('scope3')}>
              Scope 3
              {scope3Rows.length > 0 && (
                <span className="ml-1.5 text-xs bg-white/60 rounded px-1.5 py-0.5">{scope3Rows.length}</span>
              )}
            </TabButton>
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
              {activeTab === 'scope2' && (
                <>
                  <CoverageSummary metersWithCoverage={scope2Meters} />
                  <CoverageTable
                    clientId={clientId}
                    metersWithCoverage={scope2Meters}
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
                    onMeterUpdated={fetchCoverage}
                  />
                </>
              )}

              {activeTab === 'scope1-metered' && (
                <>
                  <CoverageSummary metersWithCoverage={scope1MeteredMeters} />
                  <CoverageTable
                    clientId={clientId}
                    metersWithCoverage={scope1MeteredMeters}
                    fiscalYear={fiscalYear}
                    showCategoryColumn
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
                    onMeterUpdated={fetchCoverage}
                  />
                </>
              )}

              {activeTab === 'scope1-non-metered' && (
                <NonMeteredCoverageTable
                  rows={nonMeteredRows}
                  fiscalYear={fiscalYear}
                  categoryScope={1}
                  onCellClick={(record) => setNmRecordModal(record)}
                  onEmptyCellClick={(row, cell) => setNmMarkEmptyModal({ row, cell })}
                  onLineStatusToggle={async (lineId, currentIsActive) => {
                    const res = await fetch(`/api/non-metered-lines/${lineId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ is_active: !currentIsActive }),
                    });
                    if (res.ok) {
                      const updated = await res.json();
                      applyNonMeteredLineUpdate(lineId, updated);
                    }
                  }}
                  onUpdateLine={async (lineId, field, value) => {
                    const res = await fetch(`/api/non-metered-lines/${lineId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ [field]: value }),
                    });
                    if (res.ok) {
                      const updated = await res.json();
                      applyNonMeteredLineUpdate(lineId, updated);
                    }
                  }}
                  onDeleteLine={async (lineId) => {
                    const res = await fetch(`/api/non-metered-lines/${lineId}`, { method: 'DELETE' });
                    if (!res.ok) {
                      const data = await res.json().catch(() => ({}));
                      throw new Error(data.error || 'Failed to delete line');
                    }
                    fetchNonMeteredCoverage();
                  }}
                />
              )}

              {activeTab === 'scope3' && (
                <NonMeteredCoverageTable
                  rows={scope3Rows}
                  fiscalYear={fiscalYear}
                  categoryScope={3}
                  onCellClick={(record) => setNmRecordModal(record)}
                  onEmptyCellClick={(row, cell) => setNmMarkEmptyModal({ row, cell })}
                  onLineStatusToggle={async (lineId, currentIsActive) => {
                    const res = await fetch(`/api/non-metered-lines/${lineId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ is_active: !currentIsActive }),
                    });
                    if (res.ok) {
                      const updated = await res.json();
                      applyNonMeteredLineUpdate(lineId, updated);
                    }
                  }}
                  onUpdateLine={async (lineId, field, value) => {
                    const res = await fetch(`/api/non-metered-lines/${lineId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ [field]: value }),
                    });
                    if (res.ok) {
                      const updated = await res.json();
                      applyNonMeteredLineUpdate(lineId, updated);
                    }
                  }}
                />
              )}
            </>
          )}
        </section>
      </main>

      {/* Invoice List Modal */}
      {invoiceListModalOpen && invoiceListForPeriod && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-gray-900">Invoices for Period ({invoiceListForPeriod.length})</h2>
              <button onClick={() => { setInvoiceListModalOpen(false); setInvoiceListForPeriod(null); }} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-3">
              {invoiceListForPeriod.map((inv) => (
                <div key={inv.id} className="border border-gray-100 rounded-lg p-4 hover:border-gray-200 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{inv.invoice_number || 'No invoice number'}</div>
                      <div className="text-sm text-gray-500 mt-1">{inv.period_start_date} → {inv.period_end_date}</div>
                      <div className="text-sm text-gray-400 mt-0.5">
                        Meter: {inv.meter?.lookup1 || String(inv.meter_id)}
                        {inv.amount != null && ` • $${inv.amount.toLocaleString()}`}
                        {inv.consumption != null && ` • ${inv.consumption.toLocaleString()} units`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={() => {
                          setInvoiceInitialData({
                            id: inv.id,
                            meter_id: String(inv.meter_id),
                            invoice_number: inv.invoice_number || '',
                            invoice_date: inv.invoice_date || '',
                            period_start_date: inv.period_start_date,
                            period_end_date: inv.period_end_date,
                            consumption: inv.consumption,
                            amount: inv.amount,
                            framework: inv.framework || '',
                            version: inv.version || '',
                            input_type: inv.input_type || '',
                            emissions_factor: inv.emissions_factor,
                            customer: inv.customer || '',
                          });
                          setInvoiceInitialFacilityId(inv.meter?.facility_id ? String(inv.meter.facility_id) : '');
                          setInvoiceListModalOpen(false);
                          setInvoiceListForPeriod(null);
                          setInvoiceModalOpen(true);
                        }}
                        className="px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => { setDeletingInvoice(inv); setDeletingInvoiceError(null); }}
                        className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
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
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-gray-900">{invoiceInitialData?.id ? 'Edit Invoice' : 'Add Invoice'}</h2>
              <button onClick={() => setInvoiceModalOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
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
                      body: JSON.stringify(data),
                    });
                    if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to update invoice'); }
                  } else {
                    const res = await fetch(`/api/clients/${clientId}/invoices`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(data),
                    });
                    if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to create invoice'); }
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

      {/* Non-metered record detail modal */}
      {nmRecordModal && (
        <NonMeteredRecordModal
          record={nmRecordModal}
          onClose={() => setNmRecordModal(null)}
          onMarkedReceived={() => {
            setNmRecordModal(null);
            fetchNonMeteredCoverage();
          }}
          onUnmarked={() => {
            setNmRecordModal(null);
            fetchNonMeteredCoverage();
          }}
          onStatusChanged={() => {
            setNmRecordModal(null);
            fetchNonMeteredCoverage();
          }}
        />
      )}

      {/* Non-metered empty cell — mark as received modal */}
      {nmMarkEmptyModal && (
        <NmMarkEmptyModal
          row={nmMarkEmptyModal.row}
          cell={nmMarkEmptyModal.cell}
          onClose={() => setNmMarkEmptyModal(null)}
          onMarked={() => {
            setNmMarkEmptyModal(null);
            fetchNonMeteredCoverage();
          }}
        />
      )}

      {/* Facility Settings Modal */}
      {settingsFacility && (
        <FacilitySettingsModal
          facility={settingsFacility}
          clientId={clientId}
          onClose={() => setSettingsFacility(null)}
          onFacilityDeleted={() => { setSettingsFacility(null); refreshAll(); }}
          onFacilityUpdated={() => { fetchFacilities(); fetchCoverage(); }}
        />
      )}

      {/* Add Facility Modal */}
      {addFacilityModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-lg w-full shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-gray-900">Add New Facility</h2>
              <button onClick={() => setAddFacilityModalOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <FacilityForm
              clientId={clientId}
              onSubmit={async (data) => {
                const response = await fetch(`/api/clients/${clientId}/facilities`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(data),
                });
                if (!response.ok) throw new Error('Failed to create facility');
                setAddFacilityModalOpen(false);
                fetchFacilities();
                fetchCoverage();
              }}
              onCancel={() => setAddFacilityModalOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Add Meter Modal */}
      {addMeterModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-lg w-full shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-gray-900">Add New Meter</h2>
              <button onClick={() => setAddMeterModalOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <MeterForm
              clientId={clientId}
              onSubmit={async (data: MeterFormData) => {
                const response = await fetch('/api/meters', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(data),
                });
                if (!response.ok) {
                  const result = await response.json();
                  throw new Error(result.error || 'Failed to create meter');
                }
                setAddMeterModalOpen(false);
                fetchFacilities();
                fetchCoverage();
              }}
              onCancel={() => setAddMeterModalOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {uploadModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-gray-900">Upload Invoices</h2>
              <button onClick={() => { setUploadModalOpen(false); setUploadProcessing(false); setUploadFile(null); setUploadResult(null); }} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <h3 className="font-semibold text-blue-900 mb-2 text-sm">Supported File Formats</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-blue-900 mb-1">Format 1: Meter Setup (Quick Import)</p>
                  <ul className="text-xs text-blue-800 space-y-0.5 list-disc list-inside ml-2">
                    <li>Columns: Facility, Utility, Supplier, Address, MonthsWithData</li>
                    <li>MonthsWithData: "Jul 2025 - Nov 2025" format</li>
                    <li>Auto-creates facilities, meters, and monthly records</li>
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium text-blue-900 mb-1">Format 2: Detailed Invoices / NGERS</p>
                  <ul className="text-xs text-blue-800 space-y-0.5 list-disc list-inside ml-2">
                    <li>Columns: Company, Facility, Category, Provider, Date Range, etc.</li>
                    <li>Metered (Electricity, Gas): NMI / MIRN / Account Number required</li>
                    <li>Non-metered (Diesel, LPG, Fuel, Oil etc.): no identifier needed</li>
                    <li>Date Range: DD/MM/YYYY-DD/MM/YYYY</li>
                  </ul>
                </div>
              </div>
            </div>

            <FileUpload
              onFileSelect={(file) => { setUploadFile(file); setUploadResult(null); }}
              isProcessing={uploadProcessing}
            />

            {uploadFile && !uploadResult && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <div>
                      <p className="font-medium text-gray-900">{uploadFile.name}</p>
                      <p className="text-sm text-gray-500">{(uploadFile.size / 1024).toFixed(2)} KB</p>
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      setUploadProcessing(true);
                      setUploadResult(null);
                      const controller = new AbortController();
                      const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);
                      try {
                        const formData = new FormData();
                        formData.append('file', uploadFile);
                        const response = await fetch(`/api/clients/${clientId}/upload`, {
                          method: 'POST',
                          body: formData,
                          signal: controller.signal,
                        });
                        const data = await response.json();
                        setUploadResult(data);
                        if (data.success) refreshAll();
                      } catch (err) {
                        const message = err instanceof DOMException && err.name === 'AbortError'
                          ? 'Upload timed out. The file may be too large — try splitting it into smaller batches.'
                          : 'Failed to process file. Please try again.';
                        setUploadResult({ success: false, imported: 0, errors: [message] });
                      } finally {
                        clearTimeout(timeoutId);
                        setUploadProcessing(false);
                      }
                    }}
                    disabled={uploadProcessing}
                    className="bg-emerald-600 text-white px-6 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                  >
                    {uploadProcessing ? (
                      <span className="flex items-center gap-2">
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Processing...
                      </span>
                    ) : 'Import'}
                  </button>
                </div>
              </div>
            )}

            {uploadResult && (
              <div className={`mt-4 rounded-lg p-4 ${uploadResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                <div className="flex items-start gap-3">
                  {uploadResult.success ? (
                    <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                  <div className="flex-1">
                    <h3 className={`font-semibold ${uploadResult.success ? 'text-green-900' : 'text-red-900'}`}>
                      {uploadResult.success ? 'Import Complete' : 'Import Failed'}
                    </h3>
                    <p className={`mt-1 text-sm ${uploadResult.success ? 'text-green-800' : 'text-red-800'}`}>
                      {uploadResult.imported} record{uploadResult.imported !== 1 ? 's' : ''} imported
                    </p>
                    {uploadResult.errors?.length > 0 && (
                      <div className="mt-2 bg-white rounded border border-red-200 p-2 max-h-32 overflow-y-auto">
                        {uploadResult.errors.slice(0, 5).map((error, idx) => (
                          <p key={idx} className="text-xs text-red-800">{error}</p>
                        ))}
                        {uploadResult.errors.length > 5 && (
                          <p className="text-xs text-red-600 mt-1">...and {uploadResult.errors.length - 5} more errors</p>
                        )}
                      </div>
                    )}
                    {uploadResult.success && (
                      <button onClick={() => setUploadModalOpen(false)} className="mt-3 text-sm text-emerald-600 hover:text-emerald-700 font-medium">
                        Close
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Facility Group Manager */}
      {groupManagerOpen && (
        <FacilityGroupManager
          clientId={clientId}
          facilities={facilities}
          onClose={() => setGroupManagerOpen(false)}
          onGroupSaved={fetchNonMeteredCoverage}
        />
      )}

      {/* Delete Invoice Confirmation Modal */}
      {deletingInvoice && (
        <ConfirmModal
          title="Delete Invoice"
          message={<>Are you sure you want to delete this invoice?{deletingInvoice.invoice_number && <span className="font-medium"> ({deletingInvoice.invoice_number})</span>}</>}
          subMessage={`Period: ${deletingInvoice.period_start_date} → ${deletingInvoice.period_end_date}`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          loading={deletingInvoiceLoading}
          error={deletingInvoiceError || undefined}
          onConfirm={async () => {
            setDeletingInvoiceLoading(true);
            setDeletingInvoiceError(null);
            try {
              const res = await fetch(`/api/clients/${clientId}/invoices/${deletingInvoice.id}`, { method: 'DELETE' });
              if (!res.ok) {
                const err = await res.json();
                setDeletingInvoiceError(err.error || 'Failed to delete invoice');
                setDeletingInvoiceLoading(false);
                return;
              }
              if (invoiceListForPeriod) {
                const updated = invoiceListForPeriod.filter((i) => i.id !== deletingInvoice.id);
                if (updated.length === 0) { setInvoiceListModalOpen(false); setInvoiceListForPeriod(null); }
                else setInvoiceListForPeriod(updated);
              }
              setDeletingInvoice(null);
              setDeletingInvoiceLoading(false);
              fetchCoverage();
            } catch {
              setDeletingInvoiceError('Failed to delete invoice');
              setDeletingInvoiceLoading(false);
            }
          }}
          onCancel={() => { setDeletingInvoice(null); setDeletingInvoiceError(null); }}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------
// Tab button
// -------------------------------------------------------
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
        active
          ? 'bg-white text-gray-900 shadow-sm'
          : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
      }`}
    >
      {children}
    </button>
  );
}

// -------------------------------------------------------
// Non-metered record detail modal
// -------------------------------------------------------
function NonMeteredRecordModal({
  record,
  onClose,
  onMarkedReceived,
  onUnmarked,
  onStatusChanged,
}: {
  record: NonMeteredRecord;
  onClose: () => void;
  onMarkedReceived?: () => void;
  onUnmarked?: () => void;
  onStatusChanged?: () => void;
}) {
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const statusLabel: Record<string, string> = {
    IMPORTED: 'Imported',
    INFERRED_EMPTY: 'Inferred Empty',
    MANUAL: 'Marked as Received',
    PENDING: 'Pending',
    CONFIRMED: 'Confirmed',
    ERROR: 'Error',
  };

  const statusColor: Record<string, string> = {
    IMPORTED: 'bg-green-100 text-green-700',
    INFERRED_EMPTY: 'bg-slate-100 text-slate-700',
    MANUAL: 'bg-green-100 text-green-700',
    PENDING: 'bg-amber-100 text-amber-700',
    CONFIRMED: 'bg-green-100 text-green-700',
    ERROR: 'bg-red-100 text-red-700',
  };

  const handleMarkReceived = async () => {
    setActing(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/non-metered-records/${record.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'MANUAL' }),
      });
      if (!res.ok) {
        const err = await res.json();
        setActionError(err.error || 'Failed to update record');
        return;
      }
      onMarkedReceived?.();
    } catch {
      setActionError('Failed to update record');
    } finally {
      setActing(false);
    }
  };

  const handleChangeToInferredEmpty = async () => {
    setActing(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/non-metered-records/${record.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'INFERRED_EMPTY' }),
      });
      if (!res.ok) {
        const err = await res.json();
        setActionError(err.error || 'Failed to update record');
        return;
      }
      onStatusChanged?.();
    } catch {
      setActionError('Failed to update record');
    } finally {
      setActing(false);
    }
  };

  const handleUnmark = async () => {
    setActing(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/non-metered-records/${record.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json();
        setActionError(err.error || 'Failed to remove record');
        return;
      }
      onUnmarked?.();
    } catch {
      setActionError('Failed to remove record');
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-semibold text-gray-900">Record Details</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Status</span>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${statusColor[record.status] || ''}`}>
              {statusLabel[record.status] || record.status}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Period</span>
            <span className="text-gray-900 font-medium">{record.period_start_date} → {record.period_end_date}</span>
          </div>
          {record.invoice_number && (
            <div className="flex justify-between">
              <span className="text-gray-500">Invoice No.</span>
              <span className="text-gray-900">{record.invoice_number}</span>
            </div>
          )}
          {record.invoice_date && (
            <div className="flex justify-between">
              <span className="text-gray-500">Invoice Date</span>
              <span className="text-gray-900">{record.invoice_date}</span>
            </div>
          )}
          {record.consumption != null && (
            <div className="flex justify-between">
              <span className="text-gray-500">Consumption</span>
              <span className="text-gray-900">{record.consumption.toLocaleString()} {record.unit || ''}</span>
            </div>
          )}
          {record.amount != null && (
            <div className="flex justify-between">
              <span className="text-gray-500">Amount</span>
              <span className="text-gray-900">${record.amount.toLocaleString()}</span>
            </div>
          )}
          {record.sub_category && (
            <div className="flex justify-between">
              <span className="text-gray-500">Sub-category</span>
              <span className="text-gray-900">{record.sub_category}</span>
            </div>
          )}
          {record.input_type && (
            <div className="flex justify-between">
              <span className="text-gray-500">Input Type</span>
              <span className="text-gray-900">{record.input_type}</span>
            </div>
          )}
          {record.framework && (
            <div className="flex justify-between">
              <span className="text-gray-500">Framework</span>
              <span className="text-gray-900">{record.framework} {record.version}</span>
            </div>
          )}
          {record.customer && (
            <div className="flex justify-between">
              <span className="text-gray-500">Customer</span>
              <span className="text-gray-900">{record.customer}</span>
            </div>
          )}
          {record.status === 'INFERRED_EMPTY' && (
            <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-xs text-slate-600">
                This record was automatically inferred. The facility had zero consumption for this period based on other facilities in the same group receiving invoices.
              </p>
            </div>
          )}
        </div>

        {actionError && (
          <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {actionError}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          {(record.status === 'INFERRED_EMPTY' || record.status === 'PENDING' || record.status === 'ERROR') && (
            <button
              onClick={handleMarkReceived}
              disabled={acting}
              className="w-full bg-green-600 text-white px-4 py-2.5 rounded-lg hover:bg-green-700 font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {acting ? 'Saving…' : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Mark as Received
                </>
              )}
            </button>
          )}
          {record.status !== 'INFERRED_EMPTY' && (
            <button
              onClick={handleChangeToInferredEmpty}
              disabled={acting}
              className="w-full bg-slate-500 text-white px-4 py-2.5 rounded-lg hover:bg-slate-600 font-medium transition-colors disabled:opacity-50"
            >
              {acting ? 'Saving…' : 'Change to Inferred Empty'}
            </button>
          )}
          <button
            onClick={handleUnmark}
            disabled={acting}
            className="w-full px-4 py-2.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 font-medium transition-colors disabled:opacity-50"
          >
            {acting ? 'Removing…' : 'Remove Record (No Data)'}
          </button>
          <button
            onClick={onClose}
            disabled={acting}
            className="w-full px-4 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------
// Non-metered empty cell — mark as received modal
// -------------------------------------------------------
function NmMarkEmptyModal({
  row,
  cell,
  onClose,
  onMarked,
}: {
  row: NonMeteredRowWithCoverage;
  cell: NonMeteredMonthlyCoverage;
  onClose: () => void;
  onMarked: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derive first/last day of the month from cell.monthDate
  // monthDate may be a plain string after JSON serialisation — always re-wrap
  const monthDate = new Date(cell.monthDate);
  const periodStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
    .toISOString().split('T')[0];
  const periodEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)
    .toISOString().split('T')[0];

  const handleMark = async (status: 'MANUAL' | 'INFERRED_EMPTY') => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/non-metered-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facility_id: row.facilityId,
          supplier_id: row.supplierId,
          input_type_id: row.inputTypeId,
          period_start_date: periodStart,
          period_end_date: periodEnd,
          status,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || 'Failed to create record');
        return;
      }
      onMarked();
    } catch {
      setError('Failed to create record');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Update Coverage</h2>
          <button onClick={onClose} disabled={saving} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-1">
          Set status for <span className="font-medium text-gray-900">{cell.month}</span>:
        </p>
        <ul className="text-sm text-gray-700 mb-5 space-y-0.5 pl-4 list-disc">
          <li>{row.facilityName}</li>
          <li>{row.supplierName}</li>
          <li>{row.categoryName}</li>
        </ul>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={() => handleMark('MANUAL')}
            disabled={saving}
            className="w-full bg-green-600 text-white px-4 py-2.5 rounded-lg hover:bg-green-700 font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {saving ? 'Saving…' : 'Mark as Received'}
          </button>
          <button
            onClick={() => handleMark('INFERRED_EMPTY')}
            disabled={saving}
            className="w-full bg-slate-500 text-white px-4 py-2.5 rounded-lg hover:bg-slate-600 font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Mark as Inferred Empty'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="w-full px-4 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
