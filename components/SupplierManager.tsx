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

  // Delete confirmation state
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
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow p-6 max-w-2xl w-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Manage Suppliers</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">Close</button>
        </div>
        <div className="mb-4">
          <div className="flex gap-2">
            <input
              className="flex-1 px-3 py-2 border border-gray-300 rounded"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New supplier name"
            />
            <button onClick={handleCreate} className="px-3 py-2 bg-blue-600 text-white rounded">Add</button>
          </div>
        </div>
        <div className="space-y-2 max-h-72 overflow-auto">
          {loading ? (
            <div className="text-gray-500">Loading...</div>
          ) : suppliers.length === 0 ? (
            <div className="text-gray-500">No suppliers found</div>
          ) : (
            suppliers.map((s) => (
              <div key={s.id} className="flex items-center gap-2 border border-gray-100 rounded p-2">
                <input
                  className="flex-1 px-2 py-1 border border-transparent focus:border-gray-300 rounded"
                  value={s.name}
                  onChange={(e) => setSuppliers((prev) => prev.map((p) => p.id === s.id ? { ...p, name: e.target.value } : p))}
                  onBlur={() => handleSave(s.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                />
                {savingId === s.id ? <div className="text-sm text-gray-500">Saving...</div> : null}
                <button onClick={() => promptDelete(s.id)} className="px-3 py-1 bg-red-600 text-white rounded">Delete</button>
              </div>
            ))
          )}
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
