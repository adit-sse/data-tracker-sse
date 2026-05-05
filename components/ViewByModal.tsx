'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Usage {
  clientId: string;
  clientName: string;
  facilityId: string;
  facilityName: string;
}

interface ViewByItem {
  id: string;
  name: string;
  usages: Usage[];
}

interface ViewByModalProps {
  type: 'supplier' | 'utility';
  onClose: () => void;
}

export default function ViewByModal({ type, onClose }: ViewByModalProps) {
  const [items, setItems] = useState<ViewByItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/view-by?type=${type}`);
        const data = await res.json();
        if (!cancelled && data.items) {
          setItems(data.items);
          setSelectedId(data.items[0]?.id ?? '');
        }
      } catch (err) {
        console.error('Error fetching view-by data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [type]);

  const selected = items.find(i => i.id === selectedId);
  const label = type === 'supplier' ? 'Supplier' : 'Utility';

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            View by {type === 'supplier' ? 'Suppliers' : 'Utilities'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">No {type === 'supplier' ? 'suppliers' : 'utilities'} found with client data.</p>
          ) : (
            <>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Select {label}
              </label>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-5"
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.usages.length} {item.usages.length === 1 ? 'facility' : 'facilities'})
                  </option>
                ))}
              </select>

              {selected && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">
                    Clients and facilities
                  </h3>
                  <div className="space-y-4">
                    {(() => {
                      const byClient = selected.usages.reduce((acc: Record<string, Usage[]>, u) => {
                        if (!acc[u.clientId]) acc[u.clientId] = [];
                        acc[u.clientId].push(u);
                        return acc;
                      }, {});
                      return Object.entries(byClient).map(([clientId, usages]) => (
                        <div key={clientId} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                          <Link
                            href={`/clients/${clientId}`}
                            className="block px-4 py-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 font-medium text-gray-900 dark:text-gray-100"
                          >
                            {usages[0].clientName}
                          </Link>
                          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                            {usages.map((u) => (
                              <li key={u.facilityId}>
                                <Link
                                  href={`/clients/${clientId}`}
                                  className="flex items-center px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 gap-2"
                                >
                                  <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                  </svg>
                                  {u.facilityName}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
