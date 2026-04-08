'use client';

import { useState, useEffect } from 'react';
import type { UtilityCategory } from '@/types';

export default function NeedsReviewBanner() {
  const [flagged, setFlagged] = useState<UtilityCategory[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null); // id of category being saved
  // Local edits before confirming: categoryId -> { scope, is_metered }
  const [edits, setEdits] = useState<Record<string, { scope: number; is_metered: boolean }>>({});

  useEffect(() => {
    fetchFlagged();
  }, []);

  const fetchFlagged = async () => {
    try {
      const res = await fetch('/api/input-types');
      if (!res.ok) return;
      const data: UtilityCategory[] = await res.json();
      setFlagged(data.filter((c) => c.needs_review === true));
    } catch {}
  };

  const getEdit = (cat: UtilityCategory) =>
    edits[cat.id] ?? { scope: cat.scope ?? 1, is_metered: cat.is_metered ?? false };

  const handleConfirm = async (cat: UtilityCategory) => {
    const edit = getEdit(cat);
    setSaving(cat.id);
    try {
      const res = await fetch(`/api/input-types/${cat.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cat.name,
          scope: edit.scope,
          is_metered: edit.is_metered,
          needs_review: false,
        }),
      });
      if (!res.ok) throw new Error('Failed to update');
      setFlagged((prev) => prev.filter((c) => c.id !== cat.id));
    } catch {}
    setSaving(null);
  };

  if (dismissed || flagged.length === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-amber-900 text-sm mb-1">
              {flagged.length} utility {flagged.length === 1 ? 'category needs' : 'categories need'} review
            </h3>
            <p className="text-xs text-amber-700 mb-3">
              These categories were not automatically recognised. Confirm their scope and metered status before they affect routing.
            </p>

            <div className="space-y-2">
              {flagged.map((cat) => {
                const edit = getEdit(cat);
                return (
                  <div
                    key={cat.id}
                    className="flex flex-wrap items-center gap-3 bg-white rounded-lg border border-amber-200 px-3 py-2"
                  >
                    <span className="font-medium text-gray-900 text-sm flex-shrink-0">{cat.name}</span>

                    <div className="flex items-center gap-2 flex-wrap ml-auto">
                      <label className="text-xs text-gray-500">Scope</label>
                      <select
                        value={edit.scope}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [cat.id]: { ...edit, scope: parseInt(e.target.value) },
                          }))
                        }
                        className="px-2 py-1 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                      >
                        <option value={1}>Scope 1</option>
                        <option value={2}>Scope 2</option>
                        <option value={3}>Scope 3</option>
                      </select>

                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={edit.is_metered}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [cat.id]: { ...edit, is_metered: e.target.checked },
                            }))
                          }
                          className="accent-amber-600 w-3.5 h-3.5"
                        />
                        <span className="text-xs text-gray-600">Metered</span>
                      </label>

                      <button
                        onClick={() => handleConfirm(cat)}
                        disabled={saving === cat.id}
                        className="px-3 py-1 text-xs font-semibold bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 transition-colors"
                      >
                        {saving === cat.id ? 'Saving…' : 'Confirm'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="p-1 text-amber-500 hover:text-amber-700 hover:bg-amber-100 rounded transition-colors flex-shrink-0"
          title="Dismiss (categories will still need review)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
