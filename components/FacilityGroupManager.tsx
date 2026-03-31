'use client';

import { useState, useEffect } from 'react';
import type { FacilityGroup, Supplier, UtilityCategory } from '@/types';

interface FacilityStub {
  id: string;
  name: string;
}

interface FacilityCategoryOption {
  id: string;
  name: string;
  scope: number;
  supplierId: string | null;
  supplierName: string | null;
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
  const [utilityCategories, setUtilityCategories] = useState<UtilityCategory[]>([]);
  // facilityId → scope-1 (category + supplier) combos that already have records for that facility
  const [facilityCategoryMap, setFacilityCategoryMap] = useState<Record<string, FacilityCategoryOption[]>>({});
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<FacilityGroup | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchGroups(), fetchSuppliers(), fetchUtilityCategories(), fetchFacilityCategoryMap()]);
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

  const fetchUtilityCategories = async () => {
    try {
      const res = await fetch('/api/utility-categories');
      if (!res.ok) return;
      const data = await res.json();
      setUtilityCategories(data);
    } catch {}
  };

  const fetchFacilityCategoryMap = async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/facility-utility-categories?scope=1`);
      if (!res.ok) return;
      const data = await res.json();
      setFacilityCategoryMap(data);
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
                      utilityCategories={utilityCategories}
                      facilityCategoryMap={facilityCategoryMap}
                      initial={group}
                      onSaved={handleGroupSaved}
                      onCancel={() => setEditingGroup(null)}
                    />
                  ) : (
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-semibold text-gray-900">{group.name}</span>
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                              {group.supplier?.name || 'No supplier'}
                            </span>
                            {group.utility_category ? (
                              <span className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded">
                                {group.utility_category.name}
                              </span>
                            ) : (
                              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded">
                                No utility — edit to set
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {(group.members || []).length === 0 ? (
                              <span className="text-xs text-gray-400 italic">No members</span>
                            ) : (
                              (group.members || []).map((m) => (
                                <span
                                  key={m.id}
                                  className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded flex items-center gap-1"
                                >
                                  {m.facility?.name || m.facility_id}
                                  {m.utility_category && (
                                    <span className="text-emerald-500">· {m.utility_category.name}</span>
                                  )}
                                  {!m.utility_category && (
                                    <span className="text-amber-500">· no type</span>
                                  )}
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
                utilityCategories={utilityCategories}
                facilityCategoryMap={facilityCategoryMap}
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
  utilityCategories: UtilityCategory[];
  facilityCategoryMap: Record<string, FacilityCategoryOption[]>;
  initial?: FacilityGroup;
  onSaved: () => void;
  onCancel: () => void;
}

function GroupForm({
  clientId,
  facilities,
  suppliers,
  utilityCategories,
  facilityCategoryMap,
  initial,
  onSaved,
  onCancel,
}: GroupFormProps) {
  const [name, setName] = useState(initial?.name || '');
  const [supplierId, setSupplierId] = useState(initial?.supplier_id || '');
  const [utilityCategoryId, setUtilityCategoryId] = useState(initial?.utility_category_id || '');

  // Map of facilityId → Set<utility_category_id> (multiple types per facility allowed)
  const [memberCategories, setMemberCategories] = useState<Map<string, Set<string>>>(() => {
    const map = new Map<string, Set<string>>();
    for (const m of initial?.members || []) {
      const fid = String(m.facility_id);
      if (!map.has(fid)) map.set(fid, new Set());
      if (m.utility_category_id) map.get(fid)!.add(String(m.utility_category_id));
    }
    return map;
  });

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const toggleFacility = (id: string) => {
    setMemberCategories((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, new Set());
      return next;
    });
  };

  const toggleMemberCategory = (facilityId: string, categoryId: string) => {
    setMemberCategories((prev) => {
      const next = new Map(prev);
      const cats = new Set(next.get(facilityId) ?? []);
      if (cats.has(categoryId)) cats.delete(categoryId);
      else cats.add(categoryId);
      next.set(facilityId, cats);
      return next;
    });
  };

  const handleSave = async () => {
    setFormError(null);
    if (!name.trim()) { setFormError('Group name is required'); return; }
    if (!supplierId) { setFormError('Please select a supplier'); return; }
    if (!utilityCategoryId) { setFormError('Please select a group utility type'); return; }
    if (memberCategories.size < 2) { setFormError('A group needs at least 2 facilities'); return; }
    const missingCategory = Array.from(memberCategories.values()).some((cats) => cats.size === 0);
    if (missingCategory) { setFormError('All facilities must have at least one utility type selected'); return; }

    setSaving(true);
    try {
      // Flatten: one entry per (facility, category) pair
      const facilityIds: { facility_id: string; utility_category_id: string }[] = [];
      for (const [facility_id, cats] of Array.from(memberCategories.entries())) {
        for (const utility_category_id of Array.from(cats)) {
          facilityIds.push({ facility_id, utility_category_id });
        }
      }

      if (initial) {
        const res = await fetch(`/api/facility-groups/${initial.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), utility_category_id: utilityCategoryId, facility_ids: facilityIds }),
        });
        if (!res.ok) throw new Error('Failed to update group');
      } else {
        const res = await fetch(`/api/clients/${clientId}/facility-groups`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), supplier_id: supplierId, utility_category_id: utilityCategoryId, facility_ids: facilityIds }),
        });
        if (!res.ok) throw new Error('Failed to create group');
      }

      onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed');
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
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Group Type
          <span className="ml-1.5 text-xs font-normal text-gray-400">Used to identify this group in the ingestion workflow</span>
        </label>
        <select
          value={utilityCategoryId}
          onChange={(e) => setUtilityCategoryId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
        >
          <option value="">Select group type...</option>
          {utilityCategories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Member Facilities
          <span className="ml-1.5 text-xs font-normal text-gray-400">
            ({memberCategories.size} selected) — tick a facility then tick the utility types to track
          </span>
        </label>
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {facilities.map((f) => {
            const checked = memberCategories.has(f.id);
            const selectedCats = memberCategories.get(f.id) ?? new Set<string>();
            const facilityOptions = facilityCategoryMap[f.id] ?? [];
            return (
              <div
                key={f.id}
                className={`rounded-lg border transition-colors ${
                  checked ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-gray-200'
                }`}
              >
                {/* Facility row */}
                <label className="flex items-center gap-2 p-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleFacility(f.id)}
                    className="accent-emerald-600 w-4 h-4 flex-shrink-0"
                  />
                  <span className={`text-sm font-medium flex-1 ${checked ? 'text-emerald-900' : 'text-gray-700'}`}>
                    {f.name}
                  </span>
                  {checked && selectedCats.size > 0 && (
                    <span className="text-xs text-emerald-600 font-medium">
                      {selectedCats.size} type{selectedCats.size > 1 ? 's' : ''}
                    </span>
                  )}
                  {checked && selectedCats.size === 0 && (
                    <span className="text-xs text-amber-500">none selected</span>
                  )}
                </label>

                {/* Per-facility utility type checkboxes */}
                {checked && (
                  <div className="px-3 pb-2.5 pt-0">
                    {facilityOptions.length === 0 ? (
                      <p className="text-xs text-amber-600 italic">No scope 1 records yet for this facility</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {facilityOptions.map((c, i) => {
                          const label = c.supplierName ? `${c.name} (${c.supplierName})` : c.name;
                          const isCatChecked = selectedCats.has(c.id);
                          return (
                            <label
                              key={`${c.id}__${c.supplierId ?? i}`}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs cursor-pointer transition-colors ${
                                isCatChecked
                                  ? 'bg-emerald-600 border-emerald-600 text-white'
                                  : 'bg-white border-gray-300 text-gray-600 hover:border-emerald-400'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isCatChecked}
                                onChange={() => toggleMemberCategory(f.id, c.id)}
                                className="sr-only"
                              />
                              {label}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
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

