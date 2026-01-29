'use client';

import Link from 'next/link';
import Image from 'next/image';
import { getCoverageColorClass } from '@/lib/coverage';
import type { ClientWithStats } from '@/types';

interface ClientCardProps {
  clientData: ClientWithStats;
}

export default function ClientCard({ clientData }: ClientCardProps) {
  const { client, facilitiesCount, currentMonthCoverage } = clientData;
  const { percentage, daysCovered, totalPossibleDays, month } = currentMonthCoverage;
  const colors = getCoverageColorClass(percentage);
  
  return (
    <Link href={`/clients/${client.id}`}>
      <div className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6 cursor-pointer border border-gray-200">
        {/* Client Logo and Name */}
        <div className="flex items-center gap-4 mb-4">
          {client.logo_url ? (
            <div className="w-16 h-16 relative flex-shrink-0">
              <Image 
                src={client.logo_url} 
                alt={`${client.name} logo`}
                fill
                className="object-contain"
              />
            </div>
          ) : (
            <div className="w-16 h-16 bg-gray-200 rounded flex items-center justify-center flex-shrink-0">
              <span className="text-2xl font-bold text-gray-400">
                {client.name.charAt(0)}
              </span>
            </div>
          )}
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{client.name}</h2>
            <p className="text-sm text-gray-500">{facilitiesCount} facilities</p>
          </div>
        </div>
        
        {/* Coverage Summary */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">{month} Coverage:</span>
            <span className={`font-semibold ${colors.text}`}>
              {percentage.toFixed(1)}%
            </span>
          </div>
          
          {/* Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
            <div 
              className={`${colors.bg} h-full progress-bar-transition`}
              style={{ width: `${percentage}%` }}
            />
          </div>
          
          <div className="text-xs text-gray-500 text-right">
            {daysCovered} / {totalPossibleDays} days covered
          </div>
        </div>
      </div>
    </Link>
  );
}
