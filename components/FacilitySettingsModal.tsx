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
  supplier?: { id: string; name: string } | null;
  utility_category?: { id: string; name: string } | null;
  facility?: { id: string; name: string } | null;
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

  useEffect(() => {
    fetchMeters();
    // reset fields when facility changes
    setName(facility.name);
    setAddress(facility.address || '');
  }, [facility]);

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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full">
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
            <h3 className="font-medium">Meters ({meters.length})</h3>
            {loadingMeters ? (
              <p className="text-sm text-gray-500 mt-2">Loading meters…</p>
            ) : meters.length === 0 ? (
              <p className="text-sm text-gray-500 mt-2">No meters found for this facility.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {meters.map((m) => (
                  <li key={m.id} className="flex items-center justify-between border border-gray-100 rounded px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">{m.utility_category?.name || 'N/A'}{m.supplier ? ` • ${m.supplier.name}` : ''}</div>
                      <div className="text-xs text-gray-500 mt-1">{m.lookup1 || '(no id)'} <span className="text-xs text-gray-400">{m.identifier_type}</span></div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => promptDeleteMeter(m.id)}
                        className="text-red-600 px-2 py-1 border border-red-100 rounded-md text-sm"
                        disabled={deletingMeterId === m.id}
                      >
                        {deletingMeterId === m.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
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
