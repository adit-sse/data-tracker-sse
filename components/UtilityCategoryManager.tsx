'use client';

import { useEffect, useState } from 'react';

interface Category {
  id: string;
  name: string;
}

export default function UtilityCategoryManager({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  useEffect(() => { fetchItems(); }, []);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/utility-categories');
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
      const res = await fetch(`/api/utility-categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: item.name })
      });
      if (res.ok) await fetchItems();
    } catch (err) {
      console.error('Failed to update category', err);
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this category? This may affect existing meters.')) return;
    try {
      const res = await fetch(`/api/utility-categories/${id}`, { method: 'DELETE' });
      if (res.ok) await fetchItems();
    } catch (err) {
      console.error('Failed to delete category', err);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const res = await fetch('/api/utility-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() })
      });
      if (res.ok) {
        setNewName('');
        await fetchItems();
      }
    } catch (err) {
      console.error('Failed to create category', err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow p-6 max-w-2xl w-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Manage Utility Categories</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">Close</button>
        </div>
        <div className="mb-4">
          <div className="flex gap-2">
            <input
              className="flex-1 px-3 py-2 border border-gray-300 rounded"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New category name"
            />
            <button onClick={handleCreate} className="px-3 py-2 bg-blue-600 text-white rounded">Add</button>
          </div>
        </div>
        <div className="space-y-2 max-h-72 overflow-auto">
          {loading ? (
            <div className="text-gray-500">Loading...</div>
          ) : items.length === 0 ? (
            <div className="text-gray-500">No categories found</div>
          ) : (
            items.map((i) => (
              <div key={i.id} className="flex items-center gap-2 border border-gray-100 rounded p-2">
                <input
                  className="flex-1 px-2 py-1 border border-transparent focus:border-gray-300 rounded"
                  value={i.name}
                  onChange={(e) => setItems((prev) => prev.map((p) => p.id === i.id ? { ...p, name: e.target.value } : p))}
                  onBlur={() => handleSave(i.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                />
                {savingId === i.id ? <div className="text-sm text-gray-500">Saving...</div> : null}
                <button onClick={() => handleDelete(i.id)} className="px-3 py-1 bg-red-600 text-white rounded">Delete</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
