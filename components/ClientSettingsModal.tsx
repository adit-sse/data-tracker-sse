'use client';

import { useState } from 'react';

interface ClientSettingsModalProps {
  client: {
    id: number;
    name: string;
  };
  onClose: () => void;
  onUpdated?: () => void;
}

export default function ClientSettingsModal({ client, onClose, onUpdated }: ClientSettingsModalProps) {
  const [name, setName] = useState(client.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Client name is required');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to update client');
        return;
      }

      onUpdated?.();
      onClose();
    } catch (err) {
      console.error('Error updating client:', err);
      setError('Failed to update client');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold">Edit Client</h2>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-gray-700"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="client-name" className="block text-sm font-medium text-gray-700 mb-1">
            Client Name <span className="text-red-500">*</span>
          </label>
          <input
            id="client-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter client name"
          />
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
