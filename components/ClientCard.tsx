'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import ClientSettingsModal from './ClientSettingsModal';

interface ClientCardProps {
  client: {
    id: number;
    name: string;
    logo_url?: string | null;
  };
  facilitiesCount: number;
  coveragePercentage?: number | null;
  onDeleted?: () => void;
  onUpdated?: () => void;
}

const cardColor = {
  gradient: 'from-emerald-500 to-emerald-600',
  bg: 'bg-emerald-50',
  text: 'text-emerald-600'
};

export default function ClientCard({ client, facilitiesCount, coveragePercentage, onDeleted, onUpdated }: ClientCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const getCoverageColor = (percentage: number) => {
    if (percentage >= 90) return { bg: 'bg-emerald-100', text: 'text-emerald-700' };
    if (percentage >= 70) return { bg: 'bg-amber-100', text: 'text-amber-700' };
    if (percentage >= 50) return { bg: 'bg-orange-100', text: 'text-orange-700' };
    return { bg: 'bg-red-100', text: 'text-red-700' };
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/clients/${client.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        setDeleteError(err.error || 'Failed to delete client');
        setDeleting(false);
        return;
      }

      setShowDeleteModal(false);
      setShowMenu(false);
      onDeleted?.();
    } catch (err) {
      console.error('Error deleting client:', err);
      setDeleteError('Failed to delete client');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="relative group">
      <Link href={`/clients/${client.id}`}>
        <div className="bg-white rounded-xl shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden border border-gray-100 hover:border-gray-200">
          {/* Color accent bar */}
          <div className={`h-1.5 bg-gradient-to-r ${cardColor.gradient}`} />
          
          <div className="p-5 relative">
            {/* Coverage Badge */}
            {coveragePercentage != null && (
              <div className="absolute top-2 right-8">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getCoverageColor(coveragePercentage).bg} ${getCoverageColor(coveragePercentage).text}`}>
                  {coveragePercentage}%
                </span>
              </div>
            )}

            {/* Client Logo and Name */}
            <div className="flex items-start gap-4">
              {client.logo_url ? (
                <div className="w-14 h-14 relative flex-shrink-0 rounded-lg overflow-hidden bg-gray-50">
                  <Image 
                    src={client.logo_url} 
                    alt={`${client.name} logo`}
                    fill
                    className="object-contain p-1"
                  />
                </div>
              ) : (
                <div className={`w-14 h-14 rounded-lg flex items-center justify-center flex-shrink-0 ${cardColor.bg}`}>
                  <span className={`text-xl font-bold ${cardColor.text}`}>
                    {client.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-gray-900 truncate">{client.name}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <span className="text-sm text-gray-500">
                    {facilitiesCount} {facilitiesCount === 1 ? 'facility' : 'facilities'}
                  </span>
                </div>
              </div>
            </div>
            
            {/* View Details Link */}
            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-sm text-gray-400">View details</span>
              <svg className="w-4 h-4 text-gray-400 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </div>
      </Link>

      {/* Settings Menu Button */}
      <div className="absolute top-4 right-3">
        <button
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowMenu(!showMenu); }}
          aria-haspopup="true"
          aria-expanded={showMenu}
          className="p-1.5 rounded-lg bg-white/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 hover:bg-gray-100 transition-all duration-200 shadow-sm"
          title="Client settings"
        >
          <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
        </button>

        {showMenu && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={(e) => { e.stopPropagation(); setShowMenu(false); }}
            />
            <div
              className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-50"
              onClick={(e) => e.stopPropagation()}
              role="menu"
            >
              <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowEditModal(true); setShowMenu(false); }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowDeleteModal(true); setShowMenu(false); }}
                className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </button>
            </div>
          </>
        )}
      </div>

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900">Delete Client</h2>
            </div>
            <p className="text-gray-600 mb-2">
              Are you sure you want to delete <span className="font-medium text-gray-900">{client.name}</span>?
            </p>
            <p className="text-sm text-gray-500 mb-5">
              This will permanently remove all facilities, meters, and invoices associated with this client.
            </p>
            {deleteError && (
              <div className="bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
                {deleteError}
              </div>
            )}
            <div className="flex gap-3">
              <button 
                onClick={() => setShowDeleteModal(false)} 
                className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors" 
                disabled={deleting}
              >
                Cancel
              </button>
              <button 
                onClick={handleDelete} 
                className="flex-1 bg-red-600 text-white px-4 py-2.5 rounded-lg hover:bg-red-700 font-medium transition-colors disabled:opacity-50" 
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <ClientSettingsModal
          client={client}
          onClose={() => setShowEditModal(false)}
          onUpdated={() => {
            setShowEditModal(false);
            onUpdated?.();
          }}
        />
      )}
    </div>
  );
}
