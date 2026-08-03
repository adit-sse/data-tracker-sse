'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { IntakeReportPayload } from '@/types';

/**
 * Home screen summary of the current week's file intake.
 *
 * Renders nothing at all when Google Sheets isn't configured or the fetch
 * fails. This card is supplementary — a Sheets outage or a missing service
 * account must never degrade the clients list, which is the page's actual job.
 */
export default function WeeklyIntakeCard() {
  const [data, setData] = useState<IntakeReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch('/api/intake-report');
        if (!response.ok) throw new Error('request failed');
        const json = (await response.json()) as IntakeReportPayload;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm mb-8">
        <div className="h-5 w-40 bg-gray-200 rounded animate-pulse mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <div className="h-7 w-10 bg-gray-200 rounded animate-pulse mb-1" />
              <div className="h-4 w-20 bg-gray-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (failed || !data || !data.configured) return null;

  const { totals } = data;

  return (
    <Link
      href="/intake-report"
      className="block bg-white rounded-xl p-5 border border-gray-100 shadow-sm mb-8 hover:border-gray-200 hover:shadow transition-all group"
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Data intake this week</h3>
          <p className="text-xs text-gray-500 mt-0.5">{data.weekEndingLabel}</p>
        </div>
        <span className="text-sm text-blue-600 group-hover:underline flex items-center gap-1">
          View details
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </div>

      {totals.received === 0 ? (
        <p className="text-sm text-gray-500">No files have come through yet this week.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <div className="text-2xl font-bold text-gray-900">{totals.received}</div>
            <div className="text-sm text-gray-500">Files received</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-emerald-600">{totals.done}</div>
            <div className="text-sm text-gray-500">Done</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-red-600">{totals.actionNeeded}</div>
            <div className="text-sm text-gray-500">Action needed</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-500">{totals.ignored}</div>
            <div className="text-sm text-gray-500">Ignored</div>
          </div>
        </div>
      )}
    </Link>
  );
}
