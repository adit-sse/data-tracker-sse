'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function DebugPage() {
  const params = useParams();
  const clientId = params.id as string;
  
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    fetchDebugData();
  }, [clientId]);
  
  const fetchDebugData = async () => {
    try {
      // Fetch all related data
      const [clientRes, facilitiesRes, metersRes, suppliersRes, categoriesRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/clients/${clientId}/facilities`),
        fetch(`/api/clients/${clientId}/meters`),
        fetch('/api/suppliers'),
        fetch('/api/input-types')
      ]);
      
      const [client, facilities, meters, suppliers, categories] = await Promise.all([
        clientRes.json(),
        facilitiesRes.json(),
        metersRes.json(),
        suppliersRes.json(),
        categoriesRes.json()
      ]);
      
      setData({ client, facilities, meters, suppliers, categories });
    } catch (error) {
      console.error('Error fetching debug data:', error);
    } finally {
      setLoading(false);
    }
  };
  
  if (loading) {
    return <div className="p-8">Loading...</div>;
  }
  
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">Database Debug View</h1>
          <Link
            href={`/clients/${clientId}`}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Back to Client
          </Link>
        </div>
        
        {/* Client Info */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Client</h2>
          <pre className="bg-gray-100 p-4 rounded overflow-x-auto text-sm">
            {JSON.stringify(data.client, null, 2)}
          </pre>
        </div>
        
        {/* Facilities */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">
            Facilities ({data.facilities?.length || 0})
          </h2>
          {data.facilities && data.facilities.length > 0 ? (
            <pre className="bg-gray-100 p-4 rounded overflow-x-auto text-sm">
              {JSON.stringify(data.facilities, null, 2)}
            </pre>
          ) : (
            <p className="text-gray-500">No facilities found</p>
          )}
        </div>
        
        {/* Meters */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">
            Meters ({data.meters?.length || 0})
          </h2>
          {data.meters && data.meters.length > 0 ? (
            <pre className="bg-gray-100 p-4 rounded overflow-x-auto text-sm">
              {JSON.stringify(data.meters, null, 2)}
            </pre>
          ) : (
            <p className="text-gray-500">No meters found</p>
          )}
        </div>
        
        {/* Suppliers */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">
            All Suppliers ({data.suppliers?.length || 0})
          </h2>
          {data.suppliers && data.suppliers.length > 0 ? (
            <div className="space-y-2">
              {data.suppliers.map((supplier: any) => (
                <div key={supplier.id} className="bg-gray-100 p-2 rounded text-sm">
                  <strong>{supplier.name}</strong> - ID: {supplier.id}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">No suppliers found</p>
          )}
        </div>
        
        {/* Utility Categories */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">
            Utility Categories ({data.categories?.length || 0})
          </h2>
          {data.categories && data.categories.length > 0 ? (
            <div className="space-y-2">
              {data.categories.map((category: any) => (
                <div key={category.id} className="bg-gray-100 p-2 rounded text-sm">
                  <strong>{category.name}</strong> - ID: {category.id}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">No categories found</p>
          )}
        </div>
        
        {/* Quick Actions */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Quick Debug Tests</h2>
          <div className="space-y-2 text-sm">
            <p><strong>To test meter creation manually:</strong></p>
            <ol className="list-decimal list-inside space-y-1 text-gray-700">
              <li>Open browser console (F12)</li>
              <li>Copy a facility ID from above</li>
              <li>Copy a supplier ID from above</li>
              <li>Copy a utility category ID from above</li>
              <li>Run this in console (replace IDs):
                <pre className="bg-gray-100 p-2 rounded mt-2 overflow-x-auto">
{`fetch('/api/meters', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    facility_id: 'PASTE-FACILITY-ID',
    supplier_id: 'PASTE-SUPPLIER-ID',
    input_type_id: 'PASTE-INPUT-TYPE-ID',
    identifier_type: 'NMI',
    lookup1: 'TEST12345',
    lookup2: 'WA - SWIS'
  })
}).then(r => r.json()).then(console.log)`}
                </pre>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
