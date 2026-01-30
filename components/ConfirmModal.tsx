'use client';

interface ConfirmModalProps {
  title: string;
  message: React.ReactNode;
  subMessage?: string;
  confirmLabel?: string;
  cancelLabel?: string;
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
  onConfirm,
  onCancel,
  loading = false,
  error
}: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h2 className="text-xl font-semibold mb-4 text-red-600">{title}</h2>
        <p className="text-gray-700 mb-2">{message}</p>
        {subMessage && <p className="text-sm text-gray-600 mb-4">{subMessage}</p>}
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>}
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className="flex-1 bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
            disabled={loading}
          >
            {loading ? `${confirmLabel}…` : confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
            disabled={loading}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
