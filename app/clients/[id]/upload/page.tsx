'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import FileUpload from '@/components/FileUpload';
import type { UploadResult } from '@/types';

export default function UploadPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.id as string;
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  
  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setResult(null);
  };
  
  const handleUpload = async () => {
    if (!selectedFile) return;
    
    setProcessing(true);
    setResult(null);
    
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      
      const response = await fetch(`/api/clients/${clientId}/upload`, {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      setResult(data);
      
      if (data.success && (!data.errors || data.errors.length === 0)) {
        // Auto-redirect after 2 seconds on full success
        setTimeout(() => {
          router.push(`/clients/${clientId}`);
        }, 2000);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      setResult({
        success: false,
        imported: 0,
        errors: ['Failed to process file. Please try again.']
      });
    } finally {
      setProcessing(false);
    }
  };
  
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
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
              <h1 className="text-3xl font-bold text-gray-900">Upload Invoices</h1>
              <p className="mt-1 text-sm text-gray-500">
                Upload CSV or XLSX file to import invoice data
              </p>
            </div>
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">File Format Requirements</h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>CSV or XLSX file format</li>
            <li>Must include columns: Company, Facility, Category, Provider, Date Range</li>
            <li>Date Range format: DD/MM/YYYY-DD/MM/YYYY (e.g., "01/12/2025-31/12/2025")</li>
            <li>Category must be: ELECTRICITY, GAS, FUEL, or OIL</li>
            <li>Include at least one meter identifier: NMI, Account Number, or Meter Number</li>
          </ul>
        </div>
        
        {/* File Upload */}
        <div className="bg-white rounded-lg shadow p-6">
          <FileUpload 
            onFileSelect={handleFileSelect}
            isProcessing={processing}
          />
          
          {selectedFile && !result && (
            <div className="mt-4 p-4 bg-gray-50 rounded border border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div>
                    <p className="font-medium text-gray-900">{selectedFile.name}</p>
                    <p className="text-sm text-gray-500">
                      {(selectedFile.size / 1024).toFixed(2)} KB
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleUpload}
                  disabled={processing}
                  className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {processing ? 'Processing...' : 'Import'}
                </button>
              </div>
            </div>
          )}
        </div>
        
        {/* Results */}
        {result && (
          <div className={`rounded-lg shadow p-6 ${
            result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
          }`}>
            <div className="flex items-start gap-3">
              {result.success ? (
                <svg className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              
              <div className="flex-1">
                <h3 className={`font-semibold ${result.success ? 'text-green-900' : 'text-red-900'}`}>
                  {result.success ? 'Import Complete' : 'Import Failed'}
                </h3>
                
                <p className={`mt-1 text-sm ${result.success ? 'text-green-800' : 'text-red-800'}`}>
                  {result.imported} invoice{result.imported !== 1 ? 's' : ''} imported successfully
                </p>
                
                {result.errors && result.errors.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-red-900 mb-2">
                      {result.errors.length} error{result.errors.length !== 1 ? 's' : ''}:
                    </p>
                    <div className="bg-white rounded border border-red-200 p-3 max-h-60 overflow-y-auto">
                      {result.errors.map((error, idx) => (
                        <p key={idx} className="text-sm text-red-800 font-mono">
                          {error}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                
                {result.success && result.errors.length === 0 && (
                  <p className="mt-2 text-sm text-green-700">
                    Redirecting to client page...
                  </p>
                )}
                
                {result.success && result.errors.length > 0 && (
                  <Link
                    href={`/clients/${clientId}`}
                    className="inline-block mt-4 text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    View Coverage Dashboard →
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
