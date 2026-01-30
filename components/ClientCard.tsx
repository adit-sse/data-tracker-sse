'use client';

import Link from 'next/link';
import Image from 'next/image';

interface ClientCardProps {
  client: {
    id: number;
    name: string;
    logo_url?: string | null;
  };
  facilitiesCount: number;
}

export default function ClientCard({ client, facilitiesCount }: ClientCardProps) {
  return (
    <Link href={`/clients/${client.id}`}>
      <div className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6 cursor-pointer border border-gray-200">
        {/* Client Logo and Name */}
        <div className="flex items-center gap-4">
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
            <p className="text-sm text-gray-500">
              {facilitiesCount} {facilitiesCount === 1 ? 'facility' : 'facilities'}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}
