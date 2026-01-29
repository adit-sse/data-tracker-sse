'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import InvoiceForm, { InvoiceFormData } from '@/components/InvoiceForm';

export default function NewInvoicePage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.id as string;
  
  const handleSubmit = async (data: InvoiceFormData) => {
    const response = await fetch(`/api/clients/${clientId}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create invoice');
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
              <h1 className="text-3xl font-bold text-gray-900">Add New Invoice</h1>
              <p className="mt-1 text-sm text-gray-500">
                Manually enter invoice information
              </p>
            </div>
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow p-6">
          <InvoiceForm
            clientId={clientId}
            onSubmit={handleSubmit}
            onCancel={() => router.push(`/clients/${clientId}`)}
          />
        </div>
      </main>
    </div>
  );
}
