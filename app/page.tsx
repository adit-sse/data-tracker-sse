'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import ClientCard from '@/components/ClientCard';
import SupplierManager from '@/components/SupplierManager';
import ReferenceDataManager from '@/components/ReferenceDataManager';
import ViewByModal from '@/components/ViewByModal';
import { useTheme } from '@/components/ThemeProvider';

interface Client {
  id: number;
  name: string;
  logo_url?: string | null;
}

interface ClientWithCount {
  client: Client;
  facilitiesCount: number;
}

function DarkModeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggleTheme}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      aria-label="Toggle dark mode"
    >
      {isDark ? (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )}
    </button>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [clients, setClients] = useState<ClientWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showSuppliersManager, setShowSuppliersManager] = useState(false);
  const [showUtilitiesManager, setShowUtilitiesManager] = useState(false);
  const [showViewBySuppliers, setShowViewBySuppliers] = useState(false);
  const [showViewByUtilities, setShowViewByUtilities] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  
  const fetchClients = async ({ bypassCache = false }: { bypassCache?: boolean } = {}) => {
    try {
      const response = await fetch('/api/clients', bypassCache ? { cache: 'no-store' } : undefined);
      const data = await response.json();

      if (!response.ok) {
        const message = (data && (data.error || data.message)) || 'Failed to fetch clients';
        console.error('Error fetching clients:', message);
        setFetchError(message);
        setClients([]);
        return;
      }

      setFetchError(null);

      let parsedClients: ClientWithCount[] = [];
      if (Array.isArray(data)) {
        parsedClients = data;
      } else if (data && Array.isArray((data as any).data)) {
        parsedClients = (data as any).data;
      } else {
        console.warn('Unexpected /api/clients response, defaulting to []:', data);
      }

      setClients(parsedClients);
    } catch (error) {
      console.error('Error fetching clients:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newClientName.trim()) return;
    
    setCreating(true);
    
    try {
      const response = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newClientName.trim() })
      });
      
      if (response.ok) {
        setNewClientName('');
        setShowAddModal(false);
        fetchClients({ bypassCache: true });
      }
    } catch (error) {
      console.error('Error creating client:', error);
    } finally {
      setCreating(false);
    }
  };
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      {/* Header */}
      <header className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-100 dark:border-gray-800 sticky top-0 z-30">
        <div className="mx-auto px-4 sm:px-6 lg:px-10 max-w-[1600px]">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <img 
                src="https://supersmart.energy/wp-content/uploads/2022/10/footer-logo.png" 
                alt="SSE Logo" 
                className="h-9 w-auto"
              />
              <div className="hidden sm:block">
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">SSE Data Tracker</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSuppliersManager(true)}
                className="px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-sm font-medium flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <span className="hidden sm:inline">Manage Suppliers</span>
              </button>
              <button
                onClick={() => setShowUtilitiesManager(true)}
                className="px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-sm font-medium flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="hidden sm:inline">Reference Data</span>
              </button>
              <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />
              <DarkModeToggle />
              <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />
              <button
                type="button"
                onClick={async () => {
                  const supabase = createSupabaseBrowserClient();
                  await supabase.auth.signOut();
                  router.push('/login');
                  router.refresh();
                }}
                className="px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-sm font-medium"
              >
                Sign out
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-900 transition-all font-medium text-sm flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="hidden sm:inline">Add Client</span>
              </button>
            </div>
          </div>
        </div>
      </header>
      
      {/* Blue accent bar */}
      <div className="h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-500" />
      
      {/* Main Content */}
      <main className="mx-auto px-4 sm:px-6 lg:px-10 max-w-[1600px] py-8">
        {/* Hero Section */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Welcome back</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Track utility coverage across all your clients
          </p>
        </div>
        
        {/* Stats Bar */}
        {(loading || clients.length > 0) && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700 shadow-sm">
              {loading ? (
                <div className="h-8 w-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-1" />
              ) : (
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{clients.length}</div>
              )}
              <div className="text-sm text-gray-500 dark:text-gray-400">Total Clients</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700 shadow-sm">
              {loading ? (
                <div className="h-8 w-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-1" />
              ) : (
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {clients.reduce((sum, c) => sum + c.facilitiesCount, 0)}
                </div>
              )}
              <div className="text-sm text-gray-500 dark:text-gray-400">Facilities</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700 shadow-sm col-span-2 sm:col-span-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Quick Actions</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">View clients by supplier or utility</div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowViewBySuppliers(true)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    View by Suppliers
                  </button>
                  <button
                    onClick={() => setShowViewByUtilities(true)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    View by Utilities
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="h-6 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              <div className="h-5 w-14 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <div className="h-1.5 bg-gray-200 dark:bg-gray-700" />
                  <div className="p-5 space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 rounded-lg bg-gray-200 dark:bg-gray-700 animate-pulse flex-shrink-0" />
                      <div className="flex-1 space-y-2 pt-1">
                        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4" />
                        <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded animate-pulse w-1/3" />
                      </div>
                    </div>
                    <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
                      <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded animate-pulse w-1/4" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : fetchError ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12A9 9 0 113 12a9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Unable to load clients</h3>
            <p className="mt-1 text-gray-500 dark:text-gray-400 max-w-sm mx-auto">{fetchError}</p>
            <button
              onClick={() => {
                setLoading(true);
                fetchClients({ bypassCache: true });
              }}
              className="mt-6 bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 font-medium transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : clients.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center mb-6 shadow-lg shadow-blue-500/20">
              <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">No clients yet</h3>
            <p className="mt-2 text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
              Get started by adding your first client to begin tracking utility coverage.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-6 bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 font-medium transition-colors inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Your First Client
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Your Clients</h3>
              <span className="text-sm text-gray-500 dark:text-gray-400">{clients.length} total</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {clients.map((data) => (
                <ClientCard 
                  key={data.client.id} 
                  client={data.client}
                  facilitiesCount={data.facilitiesCount}
                  onDeleted={() => fetchClients({ bypassCache: true })}
                  onUpdated={() => fetchClients({ bypassCache: true })}
                />
              ))}
            </div>
          </>
        )}
      </main>
      
      {/* Add Client Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Add New Client</h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setNewClientName('');
                }}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleCreateClient}>
              <div className="mb-5">
                <label htmlFor="clientName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Client Name
                </label>
                <input
                  type="text"
                  id="clientName"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  placeholder="e.g., Camco Engineering"
                  required
                  autoFocus
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setNewClientName('');
                  }}
                  disabled={creating}
                  className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 font-medium transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 font-medium transition-colors disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Managers */}
      {showSuppliersManager && (
        <SupplierManager onClose={() => setShowSuppliersManager(false)} />
      )}
      {showUtilitiesManager && (
        <ReferenceDataManager onClose={() => setShowUtilitiesManager(false)} />
      )}

      {/* View by Modals */}
      {showViewBySuppliers && (
        <ViewByModal type="supplier" onClose={() => setShowViewBySuppliers(false)} />
      )}
      {showViewByUtilities && (
        <ViewByModal type="utility" onClose={() => setShowViewByUtilities(false)} />
      )}
    </div>
  );
}
