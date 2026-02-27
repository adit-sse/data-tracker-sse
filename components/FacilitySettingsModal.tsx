'use client';

import { useEffect, useState } from 'react';
import ConfirmModal from './ConfirmModal';

interface FacilityShort {
  id: string;
  name: string;
  address?: string;
  meterCount: number;
}

interface Meter {
  id: string;
  lookup1?: string;
  lookup2?: string | null;
  identifier_type?: string;
  in_service_start_date?: string | null;
  in_service_end_date?: string | null;
  needs_attention?: boolean;
  supplier?: { id: string; name: string } | null;
  supplier_id?: string | null;
  utility_category?: { id: string; name: string } | null;
  facility?: { id: string; name: string } | null;
}

interface Supplier {
  id: string;
  name: string;
}

interface UtilityCategory {
  id: string;
  name: string;
}

interface FacilityOption {
  id: string;
  name: string;
}

interface MeterEditData {
  facility_id: string;
  utility_category_id: string;
  identifier_type: string;
  lookup1: string;
  lookup2: string;
  supplier_id: string;
  in_service_start_date: string;
  in_service_end_date: string;
}

export default function FacilitySettingsModal({
  facility,
  clientId,
  onClose,
  onFacilityDeleted,
  onFacilityUpdated
}: {
  facility: FacilityShort;
  clientId: string;
  onClose: () => void;
  onFacilityDeleted?: () => void;
  onFacilityUpdated?: () => void;
}) {
  const [name, setName] = useState(facility.name);
  const [address, setAddress] = useState(facility.address || '');
  const [meters, setMeters] = useState<Meter[]>([]);
  const [loadingMeters, setLoadingMeters] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingMeterId, setDeletingMeterId] = useState<string | null>(null);
  const [deletingFacility, setDeletingFacility] = useState(false);
  const [showDeleteFacilityModal, setShowDeleteFacilityModal] = useState(false);
  const [showDeleteMeterModal, setShowDeleteMeterModal] = useState(false);
  const [deleteMeterCandidateId, setDeleteMeterCandidateId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingMeterId, setEditingMeterId] = useState<string | null>(null);
  const [editMeterData, setEditMeterData] = useState<MeterEditData>({ 
    facility_id: '',
    utility_category_id: '',
    identifier_type: '',
    lookup1: '',
    lookup2: '', 
    supplier_id: '', 
    in_service_start_date: '', 
    in_service_end_date: '' 
  });
  const [savingMeter, setSavingMeter] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [allFacilities, setAllFacilities] = useState<FacilityOption[]>([]);
  const [utilityCategories, setUtilityCategories] = useState<UtilityCategory[]>([]);
  
  // Add new meter state
  const [showAddMeter, setShowAddMeter] = useState(false);
  const [newMeterData, setNewMeterData] = useState<MeterEditData>({
    facility_id: '',
    utility_category_id: '',
    identifier_type: '',
    lookup1: '',
    lookup2: '',
    supplier_id: '',
    in_service_start_date: '',
    in_service_end_date: ''
  });
  const [creatingMeter, setCreatingMeter] = useState(false);
  const [togglingAttention, setTogglingAttention] = useState<string | null>(null);

  const toggleNeedsAttention = async (meter: Meter) => {
    setTogglingAttention(meter.id);
    try {
      const res = await fetch(`/api/meters/${meter.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ needs_attention: !meter.needs_attention })
      });
      if (res.ok) {
        setMeters((prev) => prev.map((m) =>
          m.id === meter.id ? { ...m, needs_attention: !m.needs_attention } : m
        ));
        onFacilityUpdated?.();
      }
    } catch (err) {
      console.error('Error toggling needs attention:', err);
    } finally {
      setTogglingAttention(null);
    }
  };

  useEffect(() => {
    fetchMeters();
    fetchSuppliers();
    fetchFacilities();
    fetchUtilityCategories();
    // reset fields when facility changes
    setName(facility.name);
    setAddress(facility.address || '');
  }, [facility]);

  const fetchSuppliers = async () => {
    try {
      const res = await fetch('/api/suppliers');
      const data = await res.json();
      setSuppliers(data || []);
    } catch (err) {
      console.error('Error fetching suppliers:', err);
    }
  };

  const fetchFacilities = async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/facilities`);
      const data = await res.json();
      setAllFacilities(data || []);
    } catch (err) {
      console.error('Error fetching facilities:', err);
    }
  };

  const fetchUtilityCategories = async () => {
    try {
      const res = await fetch('/api/utility-categories');
      const data = await res.json();
      setUtilityCategories(data || []);
    } catch (err) {
      console.error('Error fetching utility categories:', err);
    }
  };

  const fetchMeters = async () => {
    setLoadingMeters(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/meters`);
      const data = await res.json();
      // filter to facility
      const facilityMeters = (data || []).filter((m: any) => m.facility?.id === facility.id);
      setMeters(facilityMeters);
    } catch (err) {
      console.error('Error fetching meters for facility:', err);
    } finally {
      setLoadingMeters(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/facilities/${facility.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), address: address.trim() })
      });
      if (res.ok) {
        onFacilityUpdated?.();
        onClose();
      } else {
        console.error('Failed to save facility');
      }
    } catch (err) {
      console.error('Error saving facility:', err);
    } finally {
      setSaving(false);
    }
  };

  const promptDeleteFacility = () => {
    setDeleteError(null);
    setShowDeleteFacilityModal(true);
  };

  const handleConfirmDeleteFacility = async () => {
    setDeleteError(null);
    setDeletingFacility(true);
    try {
      const res = await fetch(`/api/facilities/${facility.id}`, { method: 'DELETE' });
      if (res.ok) {
        setShowDeleteFacilityModal(false);
        onFacilityDeleted?.();
        onClose();
      } else {
        setDeleteError('Failed to delete facility');
        console.error('Failed to delete facility');
      }
    } catch (err) {
      console.error('Error deleting facility:', err);
      setDeleteError('Failed to delete facility');
    } finally {
      setDeletingFacility(false);
    }
  }; 

  const promptDeleteMeter = (meterId: string) => {
    setDeleteError(null);
    setDeleteMeterCandidateId(meterId);
    setShowDeleteMeterModal(true);
  };

  const handleConfirmDeleteMeter = async () => {
    const meterId = deleteMeterCandidateId;
    if (!meterId) return;
    setDeleteError(null);
    setDeletingMeterId(meterId);
    try {
      const res = await fetch(`/api/meters/${meterId}`, { method: 'DELETE' });
      if (res.ok) {
        setMeters((prev) => prev.filter((m) => m.id !== meterId));
        setShowDeleteMeterModal(false);
        onFacilityUpdated?.();
      } else {
        setDeleteError('Failed to delete meter');
        console.error('Failed to delete meter');
      }
    } catch (err) {
      console.error('Error deleting meter:', err);
      setDeleteError('Failed to delete meter');
    } finally {
      setDeletingMeterId(null);
      setDeleteMeterCandidateId(null);
    }
  };

  const identifierTypes = [
    { value: 'NMI', label: 'NMI' },
    { value: 'ACCOUNT_NUMBER', label: 'Account Number' },
    { value: 'METER_NUMBER', label: 'Meter Number' },
    { value: 'REGISTRATION_PLATE', label: 'Registration Plate' },
    { value: 'CARD_NUMBER', label: 'Card Number' },
    { value: 'DESCRIPTION', label: 'Description' }
  ];

  const formatIdentifierType = (type: string | undefined): string => {
    if (!type) return '';
    const typeMap: Record<string, string> = {
      'NMI': 'NMI',
      'ACCOUNT_NUMBER': 'Account Number',
      'METER_NUMBER': 'Meter Number',
      'REGISTRATION_PLATE': 'Rego Plate',
      'CARD_NUMBER': 'Card Number',
      'FACILITY_LEVEL': 'Facility Level',
      'DESCRIPTION': 'Description'
    };
    return typeMap[type] || type;
  };

  const startEditingMeter = (meter: Meter) => {
    setEditingMeterId(meter.id);
    setEditMeterData({
      facility_id: meter.facility?.id || '',
      utility_category_id: meter.utility_category?.id || '',
      identifier_type: meter.identifier_type || '',
      lookup1: meter.lookup1 || '',
      lookup2: meter.lookup2 || '',
      supplier_id: meter.supplier?.id || '',
      in_service_start_date: meter.in_service_start_date || '',
      in_service_end_date: meter.in_service_end_date || ''
    });
  };

  const cancelEditingMeter = () => {
    setEditingMeterId(null);
    setEditMeterData({ 
      facility_id: '',
      utility_category_id: '',
      identifier_type: '',
      lookup1: '',
      lookup2: '', 
      supplier_id: '', 
      in_service_start_date: '', 
      in_service_end_date: '' 
    });
  };

  const handleSaveMeter = async () => {
    if (!editingMeterId) return;
    
    if (!editMeterData.facility_id || !editMeterData.utility_category_id || !editMeterData.identifier_type || !editMeterData.lookup1) {
      return;
    }
    
    setSavingMeter(true);
    try {
      const res = await fetch(`/api/meters/${editingMeterId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facility_id: editMeterData.facility_id,
          utility_category_id: editMeterData.utility_category_id,
          identifier_type: editMeterData.identifier_type,
          lookup1: editMeterData.lookup1,
          lookup2: editMeterData.lookup2 || null,
          supplier_id: editMeterData.supplier_id || null,
          in_service_start_date: editMeterData.in_service_start_date || null,
          in_service_end_date: editMeterData.in_service_end_date || null
        })
      });
      if (res.ok) {
        const updatedMeter = await res.json();
        const newSupplier = suppliers.find(s => s.id === updatedMeter.supplier_id);
        const newFacility = allFacilities.find(f => f.id === updatedMeter.facility_id);
        const newUtilityCategory = utilityCategories.find(u => u.id === updatedMeter.utility_category_id);
        
        // If facility changed, remove from current list; otherwise update in place
        if (updatedMeter.facility_id !== facility.id) {
          setMeters((prev) => prev.filter((m) => m.id !== editingMeterId));
        } else {
          setMeters((prev) => prev.map((m) => 
            m.id === editingMeterId 
              ? { 
                  ...m, 
                  facility: newFacility ? { id: newFacility.id, name: newFacility.name } : null,
                  utility_category: newUtilityCategory ? { id: newUtilityCategory.id, name: newUtilityCategory.name } : null,
                  identifier_type: updatedMeter.identifier_type,
                  lookup1: updatedMeter.lookup1,
                  lookup2: updatedMeter.lookup2,
                  supplier: newSupplier ? { id: newSupplier.id, name: newSupplier.name } : null,
                  supplier_id: updatedMeter.supplier_id,
                  in_service_start_date: updatedMeter.in_service_start_date, 
                  in_service_end_date: updatedMeter.in_service_end_date 
                }
              : m
          ));
        }
        
        setEditingMeterId(null);
        setEditMeterData({ 
          facility_id: '',
          utility_category_id: '',
          identifier_type: '',
          lookup1: '',
          lookup2: '', 
          supplier_id: '', 
          in_service_start_date: '', 
          in_service_end_date: '' 
        });
        onFacilityUpdated?.();
      } else {
        console.error('Failed to update meter');
      }
    } catch (err) {
      console.error('Error updating meter:', err);
    } finally {
      setSavingMeter(false);
    }
  };

  const handleCreateMeter = async () => {
    if (!newMeterData.utility_category_id || !newMeterData.identifier_type || !newMeterData.lookup1) {
      return;
    }
    
    setCreatingMeter(true);
    try {
      const res = await fetch('/api/meters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facility_id: facility.id,
          utility_category_id: newMeterData.utility_category_id,
          identifier_type: newMeterData.identifier_type,
          lookup1: newMeterData.lookup1,
          lookup2: newMeterData.lookup2 || null,
          supplier_id: newMeterData.supplier_id || null,
          in_service_start_date: newMeterData.in_service_start_date || null,
          in_service_end_date: newMeterData.in_service_end_date || null
        })
      });
      
      if (res.ok) {
        // Refresh meters list
        await fetchMeters();
        // Reset form and hide it
        setShowAddMeter(false);
        setNewMeterData({
          facility_id: '',
          utility_category_id: '',
          identifier_type: '',
          lookup1: '',
          lookup2: '',
          supplier_id: '',
          in_service_start_date: '',
          in_service_end_date: ''
        });
        onFacilityUpdated?.();
      } else {
        const errorData = await res.json();
        console.error('Failed to create meter:', errorData);
      }
    } catch (err) {
      console.error('Error creating meter:', err);
    } finally {
      setCreatingMeter(false);
    }
  };

  const getMeterDisplayStatus = (meter: Meter): { label: string; color: string } => {
    if (meter.needs_attention) return { label: 'Needs attention', color: 'bg-amber-100 text-amber-700' };
    const today = new Date().toISOString().split('T')[0];
    if (meter.in_service_end_date && meter.in_service_end_date <= today) {
      return { label: 'Inactive', color: 'bg-gray-200 text-gray-600' };
    }
    if (meter.in_service_start_date && meter.in_service_start_date > today) {
      return { label: 'Not Yet Active', color: 'bg-yellow-100 text-yellow-700' };
    }
    return { label: 'Active', color: 'bg-green-100 text-green-700' };
  }; 

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold">Facility Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">Close</button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="text-sm text-gray-600">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>

          <div>
            <label className="text-sm text-gray-600">Address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium">Meters ({meters.length})</h3>
              {!showAddMeter && (
                <button
                  onClick={() => setShowAddMeter(true)}
                  className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Meter
                </button>
              )}
            </div>
            
            {/* Add Meter Form */}
            {showAddMeter && (
              <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 mb-3">
                <h4 className="text-sm font-medium text-blue-800 mb-3">Add New Meter</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500">Utility Category <span className="text-red-500">*</span></label>
                    <select
                      value={newMeterData.utility_category_id}
                      onChange={(e) => setNewMeterData({ ...newMeterData, utility_category_id: e.target.value })}
                      className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded"
                      required
                    >
                      <option value="">Select category</option>
                      {utilityCategories.map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Supplier</label>
                    <select
                      value={newMeterData.supplier_id}
                      onChange={(e) => setNewMeterData({ ...newMeterData, supplier_id: e.target.value })}
                      className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded"
                    >
                      <option value="">Select supplier</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Identifier Type <span className="text-red-500">*</span></label>
                    <select
                      value={newMeterData.identifier_type}
                      onChange={(e) => setNewMeterData({ ...newMeterData, identifier_type: e.target.value })}
                      className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded"
                      required
                    >
                      <option value="">Select type</option>
                      {identifierTypes.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Identifier <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={newMeterData.lookup1}
                      onChange={(e) => setNewMeterData({ ...newMeterData, lookup1: e.target.value })}
                      placeholder="e.g., 1234567890"
                      className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Secondary Identifier</label>
                    <input
                      type="text"
                      value={newMeterData.lookup2}
                      onChange={(e) => setNewMeterData({ ...newMeterData, lookup2: e.target.value })}
                      placeholder="Optional"
                      className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Service Start Date</label>
                    <input
                      type="date"
                      value={newMeterData.in_service_start_date}
                      onChange={(e) => setNewMeterData({ ...newMeterData, in_service_start_date: e.target.value })}
                      className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Service End Date</label>
                    <input
                      type="date"
                      value={newMeterData.in_service_end_date}
                      onChange={(e) => setNewMeterData({ ...newMeterData, in_service_end_date: e.target.value })}
                      className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-3">
                  <button
                    onClick={() => {
                      setShowAddMeter(false);
                      setNewMeterData({
                        facility_id: '',
                        utility_category_id: '',
                        identifier_type: '',
                        lookup1: '',
                        lookup2: '',
                        supplier_id: '',
                        in_service_start_date: '',
                        in_service_end_date: ''
                      });
                    }}
                    className="px-3 py-1 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateMeter}
                    disabled={creatingMeter || !newMeterData.utility_category_id || !newMeterData.identifier_type || !newMeterData.lookup1}
                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {creatingMeter ? 'Creating...' : 'Create Meter'}
                  </button>
                </div>
              </div>
            )}
            
            {loadingMeters ? (
              <p className="text-sm text-gray-500 mt-2">Loading meters…</p>
            ) : meters.length === 0 && !showAddMeter ? (
              <p className="text-sm text-gray-500 mt-2">No meters found for this facility.</p>
            ) : meters.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {meters.map((m) => {
                  const isEditing = editingMeterId === m.id;
                  
                  return (
                    <li key={m.id} className="border border-gray-100 rounded px-3 py-2">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{m.utility_category?.name || 'N/A'}{m.supplier ? ` • ${m.supplier.name}` : ''}</span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            <span className="text-gray-400">{formatIdentifierType(m.identifier_type)}:</span>
                            {m.lookup1 && <span className="ml-1">{m.lookup1}</span>}
                            {m.lookup2 && <span className="text-gray-400 ml-1">({m.lookup2})</span>}
                          </div>
                          {(m.in_service_start_date || m.in_service_end_date) && !isEditing && (
                            <div className="text-xs text-gray-400 mt-1">
                              {m.in_service_start_date && `From: ${m.in_service_start_date}`}
                              {m.in_service_start_date && m.in_service_end_date && ' • '}
                              {m.in_service_end_date && `Until: ${m.in_service_end_date}`}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {!isEditing && (
                            <>
                              <button
                                onClick={() => toggleNeedsAttention(m)}
                                disabled={togglingAttention === m.id}
                                title={m.needs_attention ? 'Clear needs attention' : 'Mark as needs attention'}
                                className={`px-2 py-1 rounded-full text-xs font-semibold ${getMeterDisplayStatus(m).color} hover:opacity-80`}
                              >
                                {togglingAttention === m.id ? '…' : getMeterDisplayStatus(m).label}
                              </button>
                              <button
                                onClick={() => startEditingMeter(m)}
                                className="text-blue-600 px-2 py-1 border border-blue-100 rounded-md text-sm hover:bg-blue-50"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => promptDeleteMeter(m.id)}
                                className="text-red-600 px-2 py-1 border border-red-100 rounded-md text-sm hover:bg-red-50"
                                disabled={deletingMeterId === m.id}
                              >
                                {deletingMeterId === m.id ? 'Deleting…' : 'Delete'}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      
                      {isEditing && (
                        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-gray-500">Facility <span className="text-red-500">*</span></label>
                              <select
                                value={editMeterData.facility_id}
                                onChange={(e) => setEditMeterData({ ...editMeterData, facility_id: e.target.value })}
                                className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded"
                                required
                              >
                                <option value="">Select facility</option>
                                {allFacilities.map(f => (
                                  <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-gray-500">Utility Type <span className="text-red-500">*</span></label>
                              <select
                                value={editMeterData.utility_category_id}
                                onChange={(e) => setEditMeterData({ ...editMeterData, utility_category_id: e.target.value })}
                                className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded"
                                required
                              >
                                <option value="">Select utility type</option>
                                {utilityCategories.map(u => (
                                  <option key={u.id} value={u.id}>{u.name}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-gray-500">Identifier Type <span className="text-red-500">*</span></label>
                              <select
                                value={editMeterData.identifier_type}
                                onChange={(e) => setEditMeterData({ ...editMeterData, identifier_type: e.target.value })}
                                className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded"
                                required
                              >
                                <option value="">Select type</option>
                                {identifierTypes.map(t => (
                                  <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-gray-500">Meter Identifier <span className="text-red-500">*</span></label>
                              <input
                                type="text"
                                value={editMeterData.lookup1}
                                onChange={(e) => setEditMeterData({ ...editMeterData, lookup1: e.target.value })}
                                placeholder="e.g., 1234567890"
                                className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded"
                                required
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-gray-500">Supplier</label>
                              <select
                                value={editMeterData.supplier_id}
                                onChange={(e) => setEditMeterData({ ...editMeterData, supplier_id: e.target.value })}
                                className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded"
                              >
                                <option value="">No Supplier</option>
                                {suppliers.map(s => (
                                  <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-gray-500">Secondary Identifier</label>
                              <input
                                type="text"
                                value={editMeterData.lookup2}
                                onChange={(e) => setEditMeterData({ ...editMeterData, lookup2: e.target.value })}
                                placeholder="e.g., WA - SWIS, LPG"
                                className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded"
                              />
                            </div>
                          </div>
                          <div>
                            <p className="text-xs font-medium text-gray-600 mb-2">Service Period</p>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-gray-500">In Service From</label>
                                <input
                                  type="date"
                                  value={editMeterData.in_service_start_date}
                                  onChange={(e) => setEditMeterData({ ...editMeterData, in_service_start_date: e.target.value })}
                                  className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-gray-500">Out of Service From</label>
                                <input
                                  type="date"
                                  value={editMeterData.in_service_end_date}
                                  onChange={(e) => setEditMeterData({ ...editMeterData, in_service_end_date: e.target.value })}
                                  className="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded"
                                />
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={handleSaveMeter}
                              disabled={savingMeter || !editMeterData.facility_id || !editMeterData.utility_category_id || !editMeterData.identifier_type || !editMeterData.lookup1}
                              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                              {savingMeter ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={cancelEditingMeter}
                              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          <div className="flex items-center gap-3 justify-end mt-4">
            <button
              onClick={() => onClose()}
              className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={promptDeleteFacility}
              className="ml-3 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              disabled={deletingFacility}
            >
              {deletingFacility ? 'Deleting…' : 'Delete Facility'}
            </button>
          </div>
        </div>
      </div>

      {showDeleteFacilityModal && (
        <ConfirmModal
          title="Delete Facility"
          message={<>Are you sure you want to delete <strong>{facility.name}</strong> and all its meters and invoices?</>}
          subMessage="This action cannot be undone."
          onConfirm={handleConfirmDeleteFacility}
          onCancel={() => setShowDeleteFacilityModal(false)}
          loading={deletingFacility}
          error={deleteError ?? undefined}
        />
      )}

      {showDeleteMeterModal && (
        <ConfirmModal
          title="Delete Meter"
          message="Are you sure you want to delete this meter and its invoices?"
          subMessage="This action cannot be undone."
          onConfirm={handleConfirmDeleteMeter}
          onCancel={() => { setShowDeleteMeterModal(false); setDeleteMeterCandidateId(null); }}
          loading={Boolean(deletingMeterId)}
          error={deleteError ?? undefined}
        />
      )}

    </div>
  );
}
