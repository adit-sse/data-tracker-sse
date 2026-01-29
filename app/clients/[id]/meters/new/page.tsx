'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import MeterForm, { MeterFormData } from '@/components/MeterForm';

export default function NewMeterPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.id as string;
  
  const handleSubmit = async (data: MeterFormData) => {
    console.log('Submitting to API:', data);
    
    const response = await fetch('/api/meters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    const result = await response.json();
    console.log('API response:', result);
    
    if (!response.ok) {
      throw new Error(result.error || result.details || 'Failed to create meter');
    }
    
    // Redirect back to client page
    router.push(`/clients/${clientId}`);
  };
  
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center gap-4">
            <Link
              href={`/clients/${clientId}`}
              className="text-gray-500 hover:text-gray-700"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Add New Meter</h1>
              <p className="mt-1 text-sm text-gray-500">
                Create a new meter for tracking invoices
              </p>
            </div>
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow p-6">
          <MeterForm
            clientId={clientId}
            onSubmit={handleSubmit}
            onCancel={() => router.push(`/clients/${clientId}`)}
          />
        </div>
      </main>
    </div>
  );
}
