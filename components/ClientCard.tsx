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
  onDeleted?: () => void;
  onUpdated?: () => void;
}

export default function ClientCard({ client, facilitiesCount, onDeleted, onUpdated }: ClientCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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
    <div className="relative">
      <Link href={`/clients/${client.id}`}>
        <div className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6 cursor-pointer border border-gray-200">
          {/* Client Logo and Name */}
          <div className="flex items-center gap-4">
            {client.logo_url ? (
              <div className="w-16 h-16 relative flex-shrink-0">
                <Image 
                  src={client.logo_url} 
                  alt={`${client.name} logo`}
                  fill
                  className="object-contain"
                />
              </div>
            ) : (
              <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center flex-shrink-0">
                <span className="text-2xl font-bold text-gray-400">
                  {client.name.charAt(0)}
                </span>
              </div>
            )}
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{client.name}</h2>
              <p className="text-sm text-gray-500">
                {facilitiesCount} {facilitiesCount === 1 ? 'facility' : 'facilities'}
              </p>
            </div>
          </div>
        </div>
      </Link>

      {/* Cog Menu */}
      <div className="absolute top-3 right-3">
        <button
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowMenu(!showMenu); }}
          aria-haspopup="true"
          aria-expanded={showMenu}
          className="p-2 rounded-full hover:bg-gray-100 border border-transparent hover:border-gray-200 focus:outline-none"
          title="Client settings"
        >
          {/* Cog Icon */}
          <svg className="w-5 h-5 text-gray-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2h-.02a2 2 0 01-2-2v-.09a1.65 1.65 0 00-1-1.51c-.7-.28-1.45-.1-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2v-.02a2 2 0 012-2h.09c.7 0 1.3-.45 1.51-1 .28-.7.1-1.45-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06c.37.37 1.12.61 1.82.33.55-.21 1-.81 1-1.51V3a2 2 0 012-2h.02a2 2 0 012 2v.09c0 .7.45 1.3 1 1.51.7.28 1.45.1 1.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06c-.37.37-.61 1.12-.33 1.82.21.55.81 1 1.51 1H21a2 2 0 012 2v.02a2 2 0 01-2 2h-.09c-.7 0-1.3.45-1.51 1z" />
          </svg>
        </button>

        {showMenu && (
          <div
            className="absolute right-0 mt-2 w-44 bg-white border border-gray-200 rounded shadow z-50"
            onClick={(e) => e.stopPropagation()}
            role="menu"
            aria-orientation="vertical"
          >
            <button
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowEditModal(true); setShowMenu(false); }}
              className="w-full text-left px-4 py-3 text-base text-gray-700 hover:bg-gray-50"
            >
              Edit Client
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowDeleteModal(true); setShowMenu(false); }}
              className="w-full text-left px-4 py-3 text-base text-red-600 hover:bg-gray-50"
            >
              Delete Client
            </button>
            <a
              href={`/clients/${client.id}/debug`}
              onClick={(e) => e.stopPropagation()}
              className="block px-4 py-3 text-base text-gray-700 hover:bg-gray-50"
            >
              Debug
            </a>
          </div>
        )}
      </div>

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-semibold mb-4 text-red-600">Delete Client</h2>
            <p className="text-gray-700 mb-2">Are you sure you want to delete <strong>{client.name}</strong> and all its associated facilities, meters, and invoices?</p>
            <p className="text-sm text-gray-600 mb-4">This action cannot be undone.</p>
            {deleteError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{deleteError}</div>}
            <div className="flex gap-3">
              <button onClick={handleDelete} className="flex-1 bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700" disabled={deleting}>{deleting ? 'Deleting...' : 'Delete'}</button>
              <button onClick={() => setShowDeleteModal(false)} className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50" disabled={deleting}>Cancel</button>
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
