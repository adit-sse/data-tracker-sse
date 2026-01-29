'use client';

import { useState, useRef } from 'react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  acceptedFormats?: string[];
  isProcessing?: boolean;
}

export default function FileUpload({ 
  onFileSelect, 
  acceptedFormats = ['.csv', '.xlsx'],
  isProcessing = false
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  
  const handleDragLeave = () => {
    setIsDragging(false);
  };
  
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };
  
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };
  
  const handleFile = (file: File) => {
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    
    if (acceptedFormats.includes(extension)) {
      onFileSelect(file);
    } else {
      alert(`Please upload a file with one of these formats: ${acceptedFormats.join(', ')}`);
    }
  };
  
  const handleClick = () => {
    fileInputRef.current?.click();
  };
  
  return (
    <div className="w-full">
      <div
        onClick={!isProcessing ? handleClick : undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-colors duration-200
          ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
          ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptedFormats.join(',')}
          onChange={handleFileInput}
          className="hidden"
          disabled={isProcessing}
        />
        
        <div className="flex flex-col items-center gap-2">
          <svg 
            className="w-12 h-12 text-gray-400" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" 
            />
          </svg>
          
          {isProcessing ? (
            <p className="text-gray-600 font-medium">Processing file...</p>
          ) : (
            <>
              <p className="text-gray-600 font-medium">
                Drop your file here, or <span className="text-blue-600">click to browse</span>
              </p>
              <p className="text-sm text-gray-500">
                Supported formats: {acceptedFormats.join(', ')}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
