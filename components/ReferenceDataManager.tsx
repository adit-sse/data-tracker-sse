'use client';

import { useEffect, useState } from 'react';
import ConfirmModal from './ConfirmModal';

interface InputType {
  id: string;
  name: string;
  scope: number | null;
  is_metered: boolean;
}

interface Category {
  id: string;
  name: string;
  scope: 1 | 2 | 3;
}

type Tab = 'input-types' | 'categories';

export default function ReferenceDataManager({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>('input-types');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl flex flex-col" style={{ maxHeight: '90vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">Reference Data</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-6 flex-shrink-0">
          <button
            onClick={() => setActiveTab('input-types')}
            className={`py-3 px-1 mr-6 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'input-types'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Input Types
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'categories'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Categories
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'input-types' ? (
            <InputTypesPanel />
          ) : (
            <CategoriesPanel />
          )}
        </div>
      </div>
    </div>
  );
}

function InputTypesPanel() {
  const [items, setItems] = useState<InputType[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [newName, setNewName] = useState('');
  const [newScope, setNewScope] = useState<number>(1);
  const [newIsMetered, setNewIsMetered] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => { fetchItems(); }, []);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/input-types');
      const data = await res.json();
      setItems(data || []);
    } catch (err) {
      console.error('Failed to fetch input types', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/input-types/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: item.name, scope: item.scope, is_metered: item.is_metered })
      });
      if (res.ok) await fetchItems();
    } catch (err) {
      console.error('Failed to update input type', err);
    } finally {
      setSavingId(null);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const res = await fetch('/api/input-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), scope: newScope, is_metered: newIsMetered })
      });
      if (res.ok) {
        setNewName('');
        setNewScope(1);
        setNewIsMetered(false);
        await fetchItems();
      }
    } catch (err) {
      console.error('Failed to create input type', err);
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
      const res = await fetch(`/api/input-types/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setShowDeleteModal(false);
        setDeleteCandidateId(null);
        await fetchItems();
      } else {
        setDeleteError('Failed to delete input type. It may be referenced by existing meters.');
      }
    } catch {
      setDeleteError('Failed to delete input type');
    } finally {
      setDeleteLoading(false);
    }
  };

  const scopeLabel = (scope: number | null) => {
    if (scope === 1) return 'Scope 1';
    if (scope === 2) return 'Scope 2';
    if (scope === 3) return 'Scope 3';
    return '—';
  };

  const filtered = items.filter((i) => i.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden min-h-0">
      <p className="text-sm text-gray-500 mb-4">
        Input types define how energy is consumed or reported (e.g. Natural gas, Electricity, Diesel oil). Each meter is linked to one input type.
      </p>

      {/* Add new */}
      <div className="flex gap-2 mb-4">
        <input
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          placeholder="New input type name"
        />
        <select
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={newScope}
          onChange={(e) => setNewScope(Number(e.target.value))}
        >
          <option value={1}>Scope 1</option>
          <option value={2}>Scope 2</option>
          <option value={3}>Scope 3</option>
        </select>
        <label className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white cursor-pointer select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={newIsMetered}
            onChange={(e) => setNewIsMetered(e.target.checked)}
            className="accent-blue-600"
          />
          Metered
        </label>
        <button
          onClick={handleCreate}
          disabled={!newName.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          Add
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search input types..."
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto space-y-1.5">
        {loading ? (
          <div className="text-gray-400 text-sm py-4 text-center">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-gray-400 text-sm py-4 text-center">
            {searchTerm ? `No results for "${searchTerm}"` : 'No input types yet'}
          </div>
        ) : filtered.map((i) => (
          <div key={i.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-2 hover:bg-gray-50">
            <input
              className="flex-1 px-2 py-1 border border-transparent hover:border-gray-300 focus:border-gray-300 rounded text-sm focus:outline-none"
              value={i.name}
              onChange={(e) => setItems((prev) => prev.map((p) => p.id === i.id ? { ...p, name: e.target.value } : p))}
              onBlur={() => handleSave(i.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
            <select
              className="px-2 py-1 border border-gray-200 rounded text-sm bg-white focus:outline-none"
              value={i.scope ?? ''}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : null;
                setItems((prev) => prev.map((p) => p.id === i.id ? { ...p, scope: val } : p));
              }}
              onBlur={() => handleSave(i.id)}
            >
              <option value="">—</option>
              <option value={1}>Scope 1</option>
              <option value={2}>Scope 2</option>
              <option value={3}>Scope 3</option>
            </select>
            <label className="flex items-center gap-1 text-sm cursor-pointer select-none whitespace-nowrap text-gray-600">
              <input
                type="checkbox"
                checked={i.is_metered}
                onChange={(e) => {
                  setItems((prev) => prev.map((p) => p.id === i.id ? { ...p, is_metered: e.target.checked } : p));
                  setTimeout(() => handleSave(i.id), 0);
                }}
                className="accent-blue-600"
              />
              Metered
            </label>
            {savingId === i.id && <span className="text-xs text-gray-400 w-10">Saving…</span>}
            <button
              onClick={() => promptDelete(i.id)}
              className="p-1.5 text-gray-400 hover:text-red-600 transition-colors rounded"
              title={`Delete ${i.name}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {showDeleteModal && (
        <ConfirmModal
          title="Delete Input Type"
          message={<>Delete this input type? This may affect existing meters and non-metered lines.</>}
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

function CategoriesPanel() {
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [newName, setNewName] = useState('');
  const [newScope, setNewScope] = useState<1 | 3>(1);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => { fetchItems(); }, []);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/categories');
      const data = await res.json();
      setItems(data || []);
    } catch (err) {
      console.error('Failed to fetch categories', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: item.name, scope: item.scope })
      });
      if (res.ok) await fetchItems();
    } catch (err) {
      console.error('Failed to update category', err);
    } finally {
      setSavingId(null);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), scope: newScope })
      });
      if (res.ok) {
        setNewName('');
        setNewScope(1);
        await fetchItems();
      }
    } catch (err) {
      console.error('Failed to create category', err);
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
      const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setShowDeleteModal(false);
        setDeleteCandidateId(null);
        await fetchItems();
      } else {
        setDeleteError('Failed to delete category. It may be referenced by existing meters or lines.');
      }
    } catch {
      setDeleteError('Failed to delete category');
    } finally {
      setDeleteLoading(false);
    }
  };

  const filtered = items.filter((i) => i.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const scope1Items = filtered.filter(i => i.scope === 1);
  const scope3Items = filtered.filter(i => i.scope === 3);

  const renderItem = (i: Category) => (
    <div key={i.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-2 hover:bg-gray-50">
      <input
        className="flex-1 px-2 py-1 border border-transparent hover:border-gray-300 focus:border-gray-300 rounded text-sm focus:outline-none"
        value={i.name}
        onChange={(e) => setItems((prev) => prev.map((p) => p.id === i.id ? { ...p, name: e.target.value } : p))}
        onBlur={() => handleSave(i.id)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      <select
        className="px-2 py-1 border border-gray-200 rounded text-sm bg-white focus:outline-none"
        value={i.scope}
        onChange={(e) => {
          const val = Number(e.target.value) as 1 | 3;
          setItems((prev) => prev.map((p) => p.id === i.id ? { ...p, scope: val } : p));
        }}
        onBlur={() => handleSave(i.id)}
      >
        <option value={1}>Scope 1</option>
        <option value={3}>Scope 3</option>
      </select>
      {savingId === i.id && <span className="text-xs text-gray-400 w-10">Saving…</span>}
      <button
        onClick={() => promptDelete(i.id)}
        className="p-1.5 text-gray-400 hover:text-red-600 transition-colors rounded"
        title={`Delete ${i.name}`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden min-h-0">
      <p className="text-sm text-gray-500 mb-4">
        Categories are NGERS groupings (e.g. Stationary Energy, Transport) used for Scope 1 and Scope 3 reporting. Each meter or line links to one category.
      </p>

      {/* Add new */}
      <div className="flex gap-2 mb-4">
        <input
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          placeholder="New category name"
        />
        <select
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={newScope}
          onChange={(e) => setNewScope(Number(e.target.value) as 1 | 3)}
        >
          <option value={1}>Scope 1</option>
          <option value={3}>Scope 3</option>
        </select>
        <button
          onClick={handleCreate}
          disabled={!newName.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          Add
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search categories..."
        />
      </div>

      {/* List grouped by scope */}
      <div className="flex-1 overflow-y-auto space-y-4">
        {loading ? (
          <div className="text-gray-400 text-sm py-4 text-center">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-gray-400 text-sm py-4 text-center">
            {searchTerm ? `No results for "${searchTerm}"` : 'No categories yet'}
          </div>
        ) : (
          <>
            {scope1Items.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Scope 1</p>
                <div className="space-y-1.5">{scope1Items.map(renderItem)}</div>
              </div>
            )}
            {scope3Items.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Scope 3</p>
                <div className="space-y-1.5">{scope3Items.map(renderItem)}</div>
              </div>
            )}
          </>
        )}
      </div>

      {showDeleteModal && (
        <ConfirmModal
          title="Delete Category"
          message={<>Delete this category? This may affect existing meters and non-metered lines.</>}
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
