'use client';

import { useState, useEffect, useRef } from 'react';
import { IDENTIFIER_TYPES, type IdentifierType } from '@/types';

interface MeterIdentifierEditorProps {
  identifierType: IdentifierType;
  lookup1: string;
  onSave: (next: { identifier_type: IdentifierType; lookup1: string }) => void;
  onClose: () => void;
}

/**
 * Edits a meter's identifier type and value together.
 *
 * Both columns belong to the UNIQUE (facility_id, input_type_id, identifier_type,
 * lookup1) constraint, so saving them in one PATCH means a single round trip and a
 * single chance of a duplicate conflict rather than two.
 */
export default function MeterIdentifierEditor({
  identifierType,
  lookup1,
  onSave,
  onClose,
}: MeterIdentifierEditorProps) {
  const [type, setType] = useState<IdentifierType>(identifierType);
  const [value, setValue] = useState(lookup1 ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const trimmed = value.trim();
  const hasChanged = type !== identifierType || trimmed !== (lookup1 ?? '').trim();
  const canSave = hasChanged && trimmed.length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave({ identifier_type: type, lookup1: trimmed });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />

      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Edit Identifier</h2>
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

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <label htmlFor="identifier-type" className="block text-sm font-medium text-gray-700 mb-1.5">
              Identifier Type
            </label>
            <select
              id="identifier-type"
              value={type}
              onChange={(e) => setType(e.target.value as IdentifierType)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {IDENTIFIER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="identifier-value" className="block text-sm font-medium text-gray-700 mb-1.5">
              Identifier
            </label>
            <input
              ref={inputRef}
              id="identifier-value"
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              placeholder="e.g. 6305123456"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {hasChanged && !trimmed && (
              <p className="mt-1.5 text-xs text-red-600">Identifier cannot be empty.</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
