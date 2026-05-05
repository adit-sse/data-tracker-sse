'use client';

import { useEffect, useState } from 'react';
import ConfirmModal from './ConfirmModal';

interface Supplier {
  id: string;
  name: string;
}

export default function SupplierManager({ onClose }: { onClose: () => void }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/suppliers');
      const data = await res.json();
      setSuppliers(data || []);
    } catch (err) {
      console.error('Failed to fetch suppliers', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (id: string) => {
    const supplier = suppliers.find((s) => s.id === id);
    if (!supplier) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/suppliers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: supplier.name })
      });
      if (res.ok) await fetchSuppliers();
    } catch (err) {
      console.error('Failed to update supplier', err);
    } finally {
      setSavingId(null);
    }
  };

  const promptDelete = (id: string) => {
    setDeleteError(null);
    setDeleteCandidateId(id);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    const id = deleteCandidateId;
    if (!id) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/suppliers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setShowDeleteModal(false);
        setDeleteCandidateId(null);
        await fetchSuppliers();
      } else {
        setDeleteError('Failed to delete supplier');
      }
    } catch (err) {
      console.error('Failed to delete supplier', err);
      setDeleteError('Failed to delete supplier');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() })
      });
      if (res.ok) {
        setNewName('');
        await fetchSuppliers();
      }
    } catch (err) {
      console.error('Failed to create supplier', err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 max-w-2xl w-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Manage Suppliers</h2>
          <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">Close</button>
        </div>
        <div className="mb-4">
          <div className="flex gap-2">
            <input
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New supplier name"
            />
            <button onClick={handleCreate} className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Add</button>
          </div>
        </div>
        
        {/* Search bar */}
        <div className="mb-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search suppliers..."
            />
          </div>
        </div>

        <div className="space-y-2 max-h-72 overflow-auto">
          {loading ? (
            <div className="text-gray-500 dark:text-gray-400">Loading...</div>
          ) : suppliers.length === 0 ? (
            <div className="text-gray-500 dark:text-gray-400">No suppliers found</div>
          ) : (() => {
            const filtered = suppliers.filter((s) => s.name.toLowerCase().includes(searchTerm.toLowerCase()));
            if (filtered.length === 0) {
              return <div className="text-gray-500 dark:text-gray-400 text-sm py-2">No suppliers match &quot;{searchTerm}&quot;</div>;
            }
            return filtered.map((s) => (
              <div key={s.id} className="flex items-center gap-2 border border-gray-100 dark:border-gray-700 rounded p-2">
                <input
                  className="flex-1 px-2 py-1 border border-transparent focus:border-gray-300 dark:focus:border-gray-500 rounded bg-transparent text-gray-900 dark:text-gray-100"
                  value={s.name}
                  onChange={(e) => setSuppliers((prev) => prev.map((p) => p.id === s.id ? { ...p, name: e.target.value } : p))}
                  onBlur={() => handleSave(s.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                />
                {savingId === s.id ? <div className="text-sm text-gray-500 dark:text-gray-400">Saving...</div> : null}
                <button onClick={() => promptDelete(s.id)} className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700">Delete</button>
              </div>
            ));
          })()}
        </div>
      </div>

      {showDeleteModal && (
        <ConfirmModal
          title="Delete Supplier"
          message={<>Are you sure you want to delete this supplier? This will remove the supplier record.</>}
          subMessage="This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleConfirmDelete}
          onCancel={() => { setShowDeleteModal(false); setDeleteCandidateId(null); setDeleteError(null); }}
          loading={deleteLoading}
          error={deleteError ?? undefined}
        />
      )}
    </div>
  );
}
