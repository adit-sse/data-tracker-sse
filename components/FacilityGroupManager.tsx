'use client';

import { useState, useEffect } from 'react';
import type { FacilityGroup, Supplier, Category, InputType } from '@/types';

interface FacilityStub {
  id: string;
  name: string;
}

interface MemberEntry {
  key: string;
  non_metered_line_id: string | null;
  facility_id: string;
  input_type_id: string;
  supplier_id: string;
}

interface FacilityGroupManagerProps {
  clientId: string;
  facilities: FacilityStub[];
  onClose: () => void;
  onGroupSaved?: () => void;
}

let memberKeyCounter = 0;
function newMemberKey() {
  return `member-${++memberKeyCounter}`;
}

export default function FacilityGroupManager({
  clientId,
  facilities,
  onClose,
  onGroupSaved,
}: FacilityGroupManagerProps) {
  const [groups, setGroups] = useState<FacilityGroup[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [reportingCategories, setReportingCategories] = useState<Category[]>([]);
  const [inputTypes, setInputTypes] = useState<InputType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<FacilityGroup | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchGroups(), fetchSuppliers(), fetchReportingCategories(), fetchInputTypes()]);
  }, []);

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/facility-groups`);
      if (!res.ok) throw new Error('Failed to load groups');
      const data = await res.json();
      setGroups(data);
    } catch {
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

  const fetchReportingCategories = async () => {
    try {
      const res = await fetch('/api/categories?scope=1');
      if (!res.ok) return;
      const data = await res.json();
      setReportingCategories(data);
    } catch {}
  };

  const fetchInputTypes = async () => {
    try {
      const res = await fetch('/api/input-types?scope=1');
      if (!res.ok) return;
      const data = await res.json();
      setInputTypes(data);
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
    await Promise.all([fetchGroups(), fetchSuppliers()]);
    onGroupSaved?.();
  };

  const handleSupplierCreated = (supplier: Supplier) => {
    setSuppliers((prev) => {
      if (prev.some((s) => s.id === supplier.id)) return prev;
      return [...prev, supplier].sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
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
                      reportingCategories={reportingCategories}
                      inputTypes={inputTypes}
                      initial={group}
                      onSaved={handleGroupSaved}
                      onCancel={() => setEditingGroup(null)}
                      onSupplierCreated={handleSupplierCreated}
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
                            {group.category ? (
                              <span className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded">
                                {group.category.name}
                              </span>
                            ) : null}
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
                                  {m.line?.facility?.name || m.line?.facility_id || m.non_metered_line_id}
                                  {m.line?.input_type && (
                                    <span className="text-emerald-500">· {m.line.input_type.name}</span>
                                  )}
                                  {(m.line?.supplier?.name || group.supplier?.name) && (
                                    <span className="text-emerald-500">
                                      · {m.line?.supplier?.name || group.supplier?.name}
                                    </span>
                                  )}
                                  {!m.line?.input_type && (
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

          {showNewForm ? (
            <div className="border border-emerald-200 rounded-lg bg-emerald-50/30">
              <GroupForm
                clientId={clientId}
                facilities={facilities}
                suppliers={suppliers}
                reportingCategories={reportingCategories}
                inputTypes={inputTypes}
                onSaved={handleGroupSaved}
                onCancel={() => setShowNewForm(false)}
                onSupplierCreated={handleSupplierCreated}
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

interface GroupFormProps {
  clientId: string;
  facilities: FacilityStub[];
  suppliers: Supplier[];
  reportingCategories: Category[];
  inputTypes: InputType[];
  initial?: FacilityGroup;
  onSaved: () => void;
  onCancel: () => void;
  onSupplierCreated: (supplier: Supplier) => void;
}

function membersFromGroup(group: FacilityGroup | undefined, defaultSupplierId: string): MemberEntry[] {
  if (!group?.members?.length) return [];
  const groupSupplier = group.supplier_id ? String(group.supplier_id) : defaultSupplierId;
  return group.members
    .map((m) => {
      const facility_id = m.line?.facility_id ? String(m.line.facility_id) : '';
      const input_type_id = m.line?.input_type_id ? String(m.line.input_type_id) : '';
      const supplier_id = m.line?.supplier_id
        ? String(m.line.supplier_id)
        : groupSupplier;
      if (!facility_id || !input_type_id) return null;
      return {
        key: newMemberKey(),
        non_metered_line_id: m.non_metered_line_id ? String(m.non_metered_line_id) : (m.line?.id ? String(m.line.id) : null),
        facility_id,
        input_type_id,
        supplier_id,
      };
    })
    .filter((m): m is MemberEntry => m !== null);
}

function GroupForm({
  clientId,
  facilities,
  suppliers,
  reportingCategories,
  inputTypes,
  initial,
  onSaved,
  onCancel,
  onSupplierCreated,
}: GroupFormProps) {
  const [name, setName] = useState(initial?.name || '');
  const [supplierId, setSupplierId] = useState(initial?.supplier_id ? String(initial.supplier_id) : '');
  const [categoryId, setCategoryId] = useState(initial?.category_id ? String(initial.category_id) : '');
  const [members, setMembers] = useState<MemberEntry[]>(() =>
    membersFromGroup(initial, initial?.supplier_id ? String(initial.supplier_id) : '')
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const addMember = () => {
    setMembers((prev) => [
      ...prev,
      {
        key: newMemberKey(),
        non_metered_line_id: null,
        facility_id: facilities[0]?.id ?? '',
        input_type_id: inputTypes[0]?.id ?? '',
        supplier_id: supplierId,
      },
    ]);
  };

  const updateMember = (key: string, patch: Partial<Omit<MemberEntry, 'key'>>) => {
    setMembers((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  };

  const removeMember = (key: string) => {
    setMembers((prev) => prev.filter((m) => m.key !== key));
  };

  const applyGroupSupplierToAll = () => {
    if (!supplierId) return;
    setMembers((prev) => prev.map((m) => ({ ...m, supplier_id: supplierId })));
  };

  const handleSave = async () => {
    setFormError(null);
    if (!name.trim()) {
      setFormError('Group name is required');
      return;
    }
    if (!supplierId) {
      setFormError('Please select a supplier');
      return;
    }
    if (members.length === 0) {
      setFormError('Add at least one group member');
      return;
    }
    const incomplete = members.some((m) => !m.facility_id || !m.input_type_id || !m.supplier_id);
    if (incomplete) {
      setFormError('Each member must have a facility, input type, and supplier');
      return;
    }

    const payloadMembers = members.map(({ non_metered_line_id, facility_id, input_type_id, supplier_id }) => ({
      non_metered_line_id,
      facility_id,
      input_type_id,
      supplier_id,
    }));

    setSaving(true);
    try {
      if (initial) {
        const res = await fetch(`/api/facility-groups/${initial.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            supplier_id: supplierId,
            category_id: categoryId || null,
            members: payloadMembers,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to update group');
        }
      } else {
        const res = await fetch(`/api/clients/${clientId}/facility-groups`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            supplier_id: supplierId,
            category_id: categoryId || null,
            members: payloadMembers,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to create group');
        }
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
          placeholder="e.g. Statewide Stationary Fuels"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      <SupplierField
        suppliers={suppliers}
        value={supplierId}
        onChange={setSupplierId}
        onSupplierCreated={onSupplierCreated}
      />

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Category
          <span className="ml-1.5 text-xs font-normal text-gray-400">
            NGERS reporting group — used to match this group in the ingestion workflow
          </span>
        </label>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
        >
          <option value="">Select category (optional)...</option>
          {reportingCategories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">
            Group Members
            <span className="ml-1.5 text-xs font-normal text-gray-400">({members.length})</span>
          </label>
          <div className="flex items-center gap-2">
            {members.length > 0 && supplierId && (
              <button
                type="button"
                onClick={applyGroupSupplierToAll}
                className="text-xs text-gray-500 hover:text-emerald-600 underline"
              >
                Set all suppliers to group supplier
              </button>
            )}
            <button
              type="button"
              onClick={addMember}
              className="text-xs px-2.5 py-1 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors"
            >
              + Add member
            </button>
          </div>
        </div>

        {members.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-4 text-center border border-dashed border-gray-200 rounded-lg">
            No members yet — click &ldquo;Add member&rdquo; to start
          </p>
        ) : (
          <div className="space-y-2">
            <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 px-1 text-xs font-medium text-gray-500">
              <span>Facility</span>
              <span>Input Type</span>
              <span>Supplier</span>
              <span className="w-8" />
            </div>
            {members.map((member) => (
              <div
                key={member.key}
                className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center bg-gray-50 border border-gray-200 rounded-lg p-2"
              >
                <select
                  value={member.facility_id}
                  onChange={(e) => updateMember(member.key, { facility_id: e.target.value })}
                  className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Select facility...</option>
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
                <select
                  value={member.input_type_id}
                  onChange={(e) => updateMember(member.key, { input_type_id: e.target.value })}
                  className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Select input type...</option>
                  {inputTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <select
                  value={member.supplier_id}
                  onChange={(e) => updateMember(member.key, { supplier_id: e.target.value })}
                  className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Select supplier...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeMember(member.key)}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors justify-self-end"
                  title="Remove member"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {formError && <p className="text-sm text-red-600">{formError}</p>}

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

interface SupplierFieldProps {
  suppliers: Supplier[];
  value: string;
  onChange: (id: string) => void;
  onSupplierCreated: (supplier: Supplier) => void;
}

function SupplierField({ suppliers, value, onChange, onSupplierCreated }: SupplierFieldProps) {
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create supplier');
      }
      const supplier = await res.json();
      onSupplierCreated(supplier);
      onChange(String(supplier.id));
      setNewName('');
      setShowNew(false);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create supplier');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Group Supplier</label>
      <div className="flex gap-2">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
        >
          <option value="">Select supplier...</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowNew((v) => !v)}
          className="px-3 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
        >
          {showNew ? 'Cancel' : '+ New'}
        </button>
      </div>
      {showNew && (
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Statewide Oil"
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="px-3 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {creating ? 'Adding...' : 'Add'}
          </button>
        </div>
      )}
      {createError && <p className="text-xs text-red-600 mt-1">{createError}</p>}
      <p className="text-xs text-gray-400 mt-1">
        Default supplier for the group. Each member can override with a different supplier if needed.
      </p>
    </div>
  );
}
