'use client';

import { useState, useEffect, useRef } from 'react';

export interface InputType {
  id: string;
  name: string;
  scope?: number;
  is_metered?: boolean;
}

interface InputTypePickerModalProps {
  inputTypes: InputType[];
  value: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

const SCOPE_CONFIG: Record<number, { label: string; badgeClass: string; ringClass: string; headerClass: string }> = {
  1: {
    label: 'Scope 1',
    badgeClass: 'bg-green-100 text-green-800',
    ringClass: 'ring-green-400',
    headerClass: 'text-green-800 border-green-200 bg-green-50',
  },
  2: {
    label: 'Scope 2',
    badgeClass: 'bg-blue-100 text-blue-800',
    ringClass: 'ring-blue-400',
    headerClass: 'text-blue-800 border-blue-200 bg-blue-50',
  },
  3: {
    label: 'Scope 3',
    badgeClass: 'bg-orange-100 text-orange-800',
    ringClass: 'ring-orange-400',
    headerClass: 'text-orange-800 border-orange-200 bg-orange-50',
  },
};

export default function InputTypePickerModal({
  inputTypes,
  value,
  onSelect,
  onClose,
}: InputTypePickerModalProps) {
  const [search, setSearch] = useState('');
  const [pendingId, setPendingId] = useState(value);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const filtered = search.trim()
    ? inputTypes.filter((it) => it.name.toLowerCase().includes(search.toLowerCase()))
    : inputTypes;

  const pendingType = inputTypes.find((it) => it.id === pendingId);
  const hasChanged = pendingId !== value && !!pendingId;

  const handleSave = () => {
    if (pendingId) {
      onSelect(pendingId);
      onClose();
    }
  };

  const scopes = [1, 2, 3];

  const renderCard = (it: InputType) => {
    const scopeCfg = SCOPE_CONFIG[it.scope ?? 0];
    const isSelected = it.id === pendingId;
    return (
      <button
        key={it.id}
        onClick={() => setPendingId(it.id)}
        className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
          isSelected
            ? `border-blue-500 bg-blue-50 ring-2 ${scopeCfg ? scopeCfg.ringClass : 'ring-blue-400'}`
            : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
        }`}
      >
        <span className="block font-medium text-gray-800 leading-snug">{it.name}</span>
        {scopeCfg && (
          <span className={`mt-1 inline-block text-xs px-1.5 py-0.5 rounded font-medium ${scopeCfg.badgeClass}`}>
            {scopeCfg.label}
          </span>
        )}
        {!scopeCfg && it.is_metered !== undefined && (
          <span className="mt-1 inline-block text-xs text-gray-400">
            {it.is_metered ? 'Metered' : 'Non-metered'}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />

      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Select Input Type</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-3 pb-2">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search input types…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 pt-1 pb-3 flex-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No input types match your search.</p>
          ) : search.trim() ? (
            <div className="grid grid-cols-2 gap-2 mt-2">
              {filtered.map(renderCard)}
            </div>
          ) : (
            <div className="space-y-4 mt-2">
              {scopes.map((scope) => {
                const scopeTypes = filtered.filter((it) => it.scope === scope);
                if (scopeTypes.length === 0) return null;
                const cfg = SCOPE_CONFIG[scope];
                return (
                  <div key={scope}>
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md border mb-2 ${cfg.headerClass}`}>
                      <span className="text-xs font-semibold uppercase tracking-wide">{cfg.label}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {scopeTypes.map(renderCard)}
                    </div>
                  </div>
                );
              })}
              {(() => {
                const unscoped = filtered.filter((it) => !it.scope || !SCOPE_CONFIG[it.scope]);
                if (unscoped.length === 0) return null;
                return (
                  <div>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border mb-2 text-gray-600 border-gray-200 bg-gray-50">
                      <span className="text-xs font-semibold uppercase tracking-wide">Other</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {unscoped.map(renderCard)}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <span className="text-sm text-gray-500 truncate">
            {pendingType ? (
              <>Selected: <span className="font-medium text-gray-800">{pendingType.name}</span></>
            ) : (
              <span className="text-gray-400">No selection</span>
            )}
          </span>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanged}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
