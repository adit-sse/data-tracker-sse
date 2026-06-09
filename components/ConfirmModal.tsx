'use client';

import { useState } from 'react';

interface ConfirmModalProps {
  title: string;
  message: React.ReactNode;
  subMessage?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When set, the user must type this exact text to enable confirm. */
  confirmText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  error?: string;
}

export default function ConfirmModal({
  title,
  message,
  subMessage,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  confirmText,
  onConfirm,
  onCancel,
  loading = false,
  error
}: ConfirmModalProps) {
  const [typedConfirm, setTypedConfirm] = useState('');
  const confirmEnabled = !confirmText || typedConfirm === confirmText;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
        <h2 className="text-xl font-semibold mb-4 text-red-600">{title}</h2>
        <p className="text-gray-700 mb-2">{message}</p>
        {subMessage && <p className="text-sm text-gray-600 mb-4">{subMessage}</p>}
        {confirmText && (
          <div className="mb-4">
            <label className="block text-sm text-gray-600 mb-1.5">
              Type <span className="font-mono font-semibold text-gray-900">{confirmText}</span> to confirm
            </label>
            <input
              type="text"
              value={typedConfirm}
              onChange={(e) => setTypedConfirm(e.target.value)}
              autoComplete="off"
              autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white text-gray-900"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && confirmEnabled && !loading) onConfirm();
              }}
            />
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className="flex-1 bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={loading || !confirmEnabled}
          >
            {loading ? `${confirmLabel}…` : confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
            disabled={loading}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
