'use client';

import { useState, useEffect } from 'react';
import type { FacilityGroup, Supplier } from '@/types';

interface FacilityStub {
  id: string;
  name: string;
}

interface FacilityGroupManagerProps {
  clientId: string;
  facilities: FacilityStub[];
  onClose: () => void;
  onGroupSaved?: () => void;
}

export default function FacilityGroupManager({
  clientId,
  facilities,
  onClose,
  onGroupSaved,
}: FacilityGroupManagerProps) {
  const [groups, setGroups] = useState<FacilityGroup[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<FacilityGroup | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchGroups(), fetchSuppliers()]);
  }, []);

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/facility-groups`);
      if (!res.ok) throw new Error('Failed to load groups');
      const data = await res.json();
      setGroups(data);
    } catch (e) {
      setError('Failed to load groups');
    } finally {
      setLoading(false);
    }
  };

  const fetchSuppliers = async () => {
    try {
      const res = await fetch('/api/suppliers');
      if (!res.ok) return;
      const data = await res.json();
      setSuppliers(data);
    } catch {}
  };

  const handleDelete = async (groupId: string) => {
    try {
      const res = await fetch(`/api/facility-groups/${groupId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setDeletingGroupId(null);
      fetchGroups();
    } catch {
      setError('Failed to delete group');
    }
  };

  const handleGroupSaved = async () => {
    setShowNewForm(false);
    setEditingGroup(null);
    await fetchGroups();
    onGroupSaved?.();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Facility Groups</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Groups define which facilities share non-metered invoices from the same supplier.
              When a group member is absent from an upload, an Inferred Empty record is created automatically.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors ml-4 flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
          )}

          {/* Existing groups */}
          {loading ? (
            <div className="text-center py-8 text-gray-500 text-sm">Loading groups...</div>
          ) : groups.length === 0 && !showNewForm ? (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm mb-4">No facility groups yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group.id} className="border border-gray-200 rounded-lg">
                  {editingGroup?.id === group.id ? (
                    <GroupForm
                      clientId={clientId}
                      facilities={facilities}
                      suppliers={suppliers}
                      initial={group}
                      onSaved={handleGroupSaved}
                      onCancel={() => setEditingGroup(null)}
                    />
                  ) : (
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-gray-900">{group.name}</span>
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                              {group.supplier?.name || 'No supplier'}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {(group.members || []).length === 0 ? (
                              <span className="text-xs text-gray-400 italic">No members</span>
                            ) : (
                              (group.members || []).map((m) => (
                                <span
                                  key={m.id}
                                  className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded"
                                >
                                  {m.facility?.name || m.facility_id}
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <button
                            onClick={() => setEditingGroup(group)}
                            className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                          >
                            Edit
                          </button>
                          {deletingGroupId === group.id ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-500">Delete?</span>
                              <button
                                onClick={() => handleDelete(group.id)}
                                className="px-2.5 py-1.5 text-xs text-white bg-red-600 border border-red-600 rounded-lg hover:bg-red-700 transition-colors"
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setDeletingGroupId(null)}
                                className="px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeletingGroupId(group.id)}
                              className="px-2.5 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* New group form */}
          {showNewForm ? (
            <div className="border border-emerald-200 rounded-lg bg-emerald-50/30">
              <GroupForm
                clientId={clientId}
                facilities={facilities}
                suppliers={suppliers}
                onSaved={handleGroupSaved}
                onCancel={() => setShowNewForm(false)}
              />
            </div>
          ) : (
            <button
              onClick={() => setShowNewForm(true)}
              className="w-full py-2.5 border-2 border-dashed border-gray-300 text-gray-500 hover:border-emerald-400 hover:text-emerald-600 rounded-lg text-sm font-medium transition-colors"
            >
              + New Group
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------
// GroupForm — used for both create and edit
// -------------------------------------------------------
interface GroupFormProps {
  clientId: string;
  facilities: FacilityStub[];
  suppliers: Supplier[];
  initial?: FacilityGroup;
  onSaved: () => void;
  onCancel: () => void;
}

function GroupForm({
  clientId,
  facilities,
  suppliers,
  initial,
  onSaved,
  onCancel,
}: GroupFormProps) {
  const [name, setName] = useState(initial?.name || '');
  const [supplierId, setSupplierId] = useState(initial?.supplier_id || '');
  const [selectedFacilityIds, setSelectedFacilityIds] = useState<Set<string>>(
    new Set((initial?.members || []).map((m) => m.facility_id))
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const toggleFacility = (id: string) => {
    setSelectedFacilityIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setFormError(null);
    if (!name.trim()) { setFormError('Group name is required'); return; }
    if (!supplierId) { setFormError('Please select a supplier'); return; }
    if (selectedFacilityIds.size < 2) { setFormError('A group needs at least 2 facilities'); return; }

    setSaving(true);
    try {
      const facilityIds = Array.from(selectedFacilityIds);

      if (initial) {
        // Update existing group
        const res = await fetch(`/api/facility-groups/${initial.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), facility_ids: facilityIds }),
        });
        if (!res.ok) throw new Error('Failed to update group');
      } else {
        // Create new group
        const res = await fetch(`/api/clients/${clientId}/facility-groups`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), supplier_id: supplierId, facility_ids: facilityIds }),
        });
        if (!res.ok) throw new Error('Failed to create group');
      }

      // Backfill runs server-side within the facility-groups API routes
      onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed');
      onBackfillStatus(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Group Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Fleet Vehicles — AcmeFuel"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      {!initial && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
          >
            <option value="">Select supplier...</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">Supplier cannot be changed after creation.</p>
        </div>
      )}

      {initial && (
        <div className="text-sm text-gray-600">
          <span className="font-medium">Supplier:</span> {initial.supplier?.name}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Member Facilities
          <span className="ml-1.5 text-xs font-normal text-gray-400">({selectedFacilityIds.size} selected)</span>
        </label>
        <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
          {facilities.map((f) => {
            const checked = selectedFacilityIds.has(f.id);
            return (
              <label
                key={f.id}
                className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  checked
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleFacility(f.id)}
                  className="accent-emerald-600 w-4 h-4 flex-shrink-0"
                />
                <span className="text-sm font-medium truncate">{f.name}</span>
              </label>
            );
          })}
        </div>
      </div>

      {formError && (
        <p className="text-sm text-red-600">{formError}</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          disabled={saving}
          className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : initial ? 'Save Changes' : 'Create Group'}
        </button>
      </div>
    </div>
  );
}

