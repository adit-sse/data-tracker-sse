'use client';

import { useState, useEffect } from 'react';
import ClientCard from '@/components/ClientCard';
import SupplierManager from '@/components/SupplierManager';
import UtilityCategoryManager from '@/components/UtilityCategoryManager';

interface Client {
  id: number;
  name: string;
  logo_url?: string | null;
}

interface ClientWithCount {
  client: Client;
  facilitiesCount: number;
}

export default function HomePage() {
  const [clients, setClients] = useState<ClientWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showSuppliersManager, setShowSuppliersManager] = useState(false);
  const [showUtilitiesManager, setShowUtilitiesManager] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  
  useEffect(() => {
    fetchClients();
  }, []);
  
  const fetchClients = async () => {
    try {
      const response = await fetch('/api/clients');
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
      } else if (data && Array.isArray((data as any).clients)) {
        parsedClients = (data as any).clients;
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
        fetchClients();
      }
    } catch (error) {
      console.error('Error creating client:', error);
    } finally {
      setCreating(false);
    }
  };
  
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-16 h-16 mx-auto">
            <div className="absolute inset-0 rounded-full border-4 border-blue-100"></div>
            <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin"></div>
          </div>
          <p className="mt-4 text-gray-500 font-medium">Loading clients...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-30">
        <div className="mx-auto px-4 sm:px-6 lg:px-10 max-w-[1600px]">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <img 
                src="https://supersmart.energy/wp-content/uploads/2022/10/footer-logo.png" 
                alt="SSE Logo" 
                className="h-9 w-auto"
              />
              <div className="hidden sm:block">
                <h1 className="text-xl font-bold text-gray-900">SSE Data Tracker</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSuppliersManager(true)}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Manage Suppliers"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </button>
              <button
                onClick={() => setShowUtilitiesManager(true)}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Manage Utilities"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </button>
              <div className="w-px h-6 bg-gray-200 mx-1" />
              <button
                onClick={() => setShowAddModal(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all font-medium text-sm flex items-center gap-1.5"
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
      
      {/* Main Content */}
      <main className="mx-auto px-4 sm:px-6 lg:px-10 max-w-[1600px] py-8">
        {/* Hero Section */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
          <p className="text-gray-500 mt-1">
            Track utility coverage across all your clients
          </p>
        </div>
        
        {/* Stats Bar */}
        {clients.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
              <div className="text-2xl font-bold text-gray-900">{clients.length}</div>
              <div className="text-sm text-gray-500">Total Clients</div>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
              <div className="text-2xl font-bold text-emerald-600">
                {clients.reduce((sum, c) => sum + c.facilitiesCount, 0)}
              </div>
              <div className="text-sm text-gray-500">Facilities</div>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm col-span-2 sm:col-span-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-900">Quick Actions</div>
                  <div className="text-xs text-gray-500 mt-0.5">Manage your data</div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowSuppliersManager(true)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Suppliers
                  </button>
                  <button
                    onClick={() => setShowUtilitiesManager(true)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Utilities
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {fetchError ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12A9 9 0 113 12a9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Unable to load clients</h3>
            <p className="mt-1 text-gray-500 max-w-sm mx-auto">{fetchError}</p>
            <button
              onClick={() => {
                setLoading(true);
                fetchClients();
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
            <h3 className="text-xl font-semibold text-gray-900">No clients yet</h3>
            <p className="mt-2 text-gray-500 max-w-sm mx-auto">
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
              <h3 className="text-lg font-semibold text-gray-900">Your Clients</h3>
              <span className="text-sm text-gray-500">{clients.length} total</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {clients.map((data) => (
                <ClientCard 
                  key={data.client.id} 
                  client={data.client}
                  facilitiesCount={data.facilitiesCount}
                  onDeleted={() => fetchClients()}
                  onUpdated={() => fetchClients()}
                />
              ))}
            </div>
          </>
        )}
      </main>
      
      {/* Add Client Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-gray-900">Add New Client</h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setNewClientName('');
                }}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleCreateClient}>
              <div className="mb-5">
                <label htmlFor="clientName" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Client Name
                </label>
                <input
                  type="text"
                  id="clientName"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
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
                  className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors disabled:opacity-50"
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
        <UtilityCategoryManager onClose={() => setShowUtilitiesManager(false)} />
      )}
    </div>
  );
}
