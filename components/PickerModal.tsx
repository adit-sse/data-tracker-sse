'use client';

import { useState, useEffect, useRef } from 'react';

export interface PickerItem {
  id: string;
  name: string;
  /** When provided the modal groups items under a labelled header. */
  group?: string;
}

interface PickerModalProps {
  title: string;
  items: PickerItem[];
  value: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

export default function PickerModal({
  title,
  items,
  value,
  onSelect,
  onClose,
  searchPlaceholder = 'Search…',
  emptyMessage = 'No items match your search.',
}: PickerModalProps) {
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
    ? items.filter((it) => it.name.toLowerCase().includes(search.toLowerCase()))
    : items;

  const pendingItem = items.find((it) => it.id === pendingId);
  const hasChanged = pendingId !== value && !!pendingId;

  const handleSave = () => {
    if (pendingId) {
      onSelect(pendingId);
      onClose();
    }
  };

  const renderCard = (it: PickerItem) => {
    const isSelected = it.id === pendingId;
    return (
      <button
        key={it.id}
        onClick={() => setPendingId(it.id)}
        className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
          isSelected
            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-400'
            : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
        }`}
      >
        <span className="block font-medium text-gray-800 leading-snug">{it.name}</span>
      </button>
    );
  };

  const hasGroups = items.some((it) => it.group);

  const renderBody = () => {
    if (filtered.length === 0) {
      return (
        <p className="text-sm text-gray-400 text-center py-8">{emptyMessage}</p>
      );
    }

    // Flat grid when searching or no items have a group
    if (search.trim() || !hasGroups) {
      return (
        <div className="grid grid-cols-2 gap-2 mt-2">
          {filtered.map(renderCard)}
        </div>
      );
    }

    // Grouped view
    const groupOrder = Array.from(
      new Map(items.filter((it) => it.group).map((it) => [it.group!, true])).keys()
    );
    const ungrouped = filtered.filter((it) => !it.group);

    return (
      <div className="space-y-4 mt-2">
        {groupOrder.map((group) => {
          const groupItems = filtered.filter((it) => it.group === group);
          if (groupItems.length === 0) return null;
          return (
            <div key={group}>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border mb-2 text-gray-600 border-gray-200 bg-gray-50">
                <span className="text-xs font-semibold uppercase tracking-wide">{group}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {groupItems.map(renderCard)}
              </div>
            </div>
          );
        })}
        {ungrouped.length > 0 && (
          <div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border mb-2 text-gray-600 border-gray-200 bg-gray-50">
              <span className="text-xs font-semibold uppercase tracking-wide">Other</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ungrouped.map(renderCard)}
            </div>
          </div>
        )}
      </div>
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
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
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
              placeholder={searchPlaceholder}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 pt-1 pb-3 flex-1">
          {renderBody()}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <span className="text-sm text-gray-500 truncate">
            {pendingItem ? (
              <>Selected: <span className="font-medium text-gray-800">{pendingItem.name}</span></>
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
