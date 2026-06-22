'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { IngestionEvent, StuckPendingRecord } from '@/types';

// ---------------------------------------------------------------------------
// Types (Stuck tab still uses local shape until Step 4)
// ---------------------------------------------------------------------------

type StuckRecord = StuckPendingRecord;

// ---------------------------------------------------------------------------
// Dummy data
// ---------------------------------------------------------------------------

const now = new Date();
function hoursAgo(h: number) {
  return new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();
}

const DUMMY_STUCK: StuckRecord[] = [
  // Acme Corp / Sydney HQ / Origin Energy — 4 months stuck > 7 days
  { id: 1,  kind: 'non-metered', client_id: 1, client_name: 'Acme Corp',      facility_name: 'Sydney HQ',       supplier_name: 'Origin Energy', utility_name: 'Natural Gas',  period_start: '2024-07-01', created_at: hoursAgo(240), age_hours: 240 },
  { id: 2,  kind: 'non-metered', client_id: 1, client_name: 'Acme Corp',      facility_name: 'Sydney HQ',       supplier_name: 'Origin Energy', utility_name: 'Natural Gas',  period_start: '2024-08-01', created_at: hoursAgo(238), age_hours: 238 },
  { id: 3,  kind: 'non-metered', client_id: 1, client_name: 'Acme Corp',      facility_name: 'Sydney HQ',       supplier_name: 'Origin Energy', utility_name: 'Natural Gas',  period_start: '2024-09-01', created_at: hoursAgo(195), age_hours: 195 },
  { id: 4,  kind: 'non-metered', client_id: 1, client_name: 'Acme Corp',      facility_name: 'Sydney HQ',       supplier_name: 'Origin Energy', utility_name: 'Natural Gas',  period_start: '2024-10-01', created_at: hoursAgo(180), age_hours: 180 },
  // Acme Corp / Melbourne Depot / AGL — single metered, > 7 days
  { id: 5,  kind: 'metered',     client_id: 1, client_name: 'Acme Corp',      facility_name: 'Melbourne Depot', supplier_name: 'AGL',           utility_name: 'Electricity',  period_start: '2024-08-01', created_at: hoursAgo(195), age_hours: 195 },
  // Globex / Brisbane / Elgas — 2 months, amber
  { id: 6,  kind: 'non-metered', client_id: 2, client_name: 'Globex Ltd',     facility_name: 'Brisbane Office', supplier_name: 'Elgas',         utility_name: 'LPG',          period_start: '2024-09-01', created_at: hoursAgo(36),  age_hours: 36  },
  { id: 7,  kind: 'non-metered', client_id: 2, client_name: 'Globex Ltd',     facility_name: 'Brisbane Office', supplier_name: 'Elgas',         utility_name: 'LPG',          period_start: '2024-10-01', created_at: hoursAgo(28),  age_hours: 28  },
  // Globex / Perth — single, recent
  { id: 8,  kind: 'metered',     client_id: 2, client_name: 'Globex Ltd',     facility_name: 'Perth Plant',     supplier_name: 'Synergy',       utility_name: 'Electricity',  period_start: '2024-10-01', created_at: hoursAgo(4),   age_hours: 4   },
  // Initech — single, recent
  { id: 9,  kind: 'non-metered', client_id: 3, client_name: 'Initech Pty',    facility_name: 'Adelaide DC',     supplier_name: 'Santos',        utility_name: 'Natural Gas',  period_start: '2024-11-01', created_at: hoursAgo(1.5), age_hours: 1.5 },
  // Umbrella — 3 months, red
  { id: 10, kind: 'non-metered', client_id: 4, client_name: 'Umbrella Group', facility_name: 'Gold Coast Hub',  supplier_name: 'Ergon Energy',  utility_name: 'Diesel',       period_start: '2025-01-01', created_at: hoursAgo(190), age_hours: 190 },
  { id: 11, kind: 'non-metered', client_id: 4, client_name: 'Umbrella Group', facility_name: 'Gold Coast Hub',  supplier_name: 'Ergon Energy',  utility_name: 'Diesel',       period_start: '2025-02-01', created_at: hoursAgo(165), age_hours: 165 },
  { id: 12, kind: 'non-metered', client_id: 4, client_name: 'Umbrella Group', facility_name: 'Gold Coast Hub',  supplier_name: 'Ergon Energy',  utility_name: 'Diesel',       period_start: '2025-03-01', created_at: hoursAgo(140), age_hours: 140 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventClientName(ev: IngestionEvent): string {
  const joined = ev.client as { name?: string } | { name?: string }[] | null | undefined;
  const joinedName = Array.isArray(joined) ? joined[0]?.name : joined?.name;
  return joinedName ?? ev.client_name ?? 'Unknown client';
}

type AgeFilter = 'all' | '1h' | '6h' | '24h';

const AGE_FILTER_OPTIONS: { label: string; value: AgeFilter; minHours: number }[] = [
  { label: 'All',   value: 'all', minHours: 0  },
  { label: '> 1h',  value: '1h',  minHours: 1  },
  { label: '> 6h',  value: '6h',  minHours: 6  },
  { label: '> 24h', value: '24h', minHours: 24 },
];

// Maps raw endpoint strings to a display category for filtering
type EventCategory = 'all' | 'pending' | 'confirm' | 'error' | 'inferred-empty';

function endpointCategory(endpoint: string): EventCategory {
  if (endpoint.includes('pending')) return 'pending';
  if (endpoint.includes('confirm')) return 'confirm';
  if (endpoint.includes('error'))   return 'error';
  if (endpoint.includes('inferred-empty')) return 'inferred-empty';
  return 'confirm';
}

function formatAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours % 24);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function formatPeriod(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function ageRowClass(hours: number): string {
  if (hours >= 168) return 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/50';
  if (hours >= 24)  return 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50';
  return 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700';
}

function ageBadgeClass(hours: number): string {
  if (hours >= 168) return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
  if (hours >= 24)  return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
}

// ---------------------------------------------------------------------------
// Stuck Pending — grouping
// ---------------------------------------------------------------------------

type GroupedRow = {
  key: string;
  client_id: number;
  client_name: string;
  facility_name: string | null;
  supplier_name: string | null;
  kind: 'metered' | 'non-metered' | 'mixed';
  count: number;
  oldest_hours: number;
};

function groupRecords(records: StuckRecord[]): GroupedRow[] {
  const map = new Map<string, GroupedRow>();
  for (const r of records) {
    const key = `${r.client_id}||${r.facility_name ?? ''}||${r.supplier_name ?? ''}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      if (r.age_hours > existing.oldest_hours) existing.oldest_hours = r.age_hours;
      if (existing.kind !== r.kind) existing.kind = 'mixed';
    } else {
      map.set(key, {
        key, client_id: r.client_id, client_name: r.client_name,
        facility_name: r.facility_name, supplier_name: r.supplier_name,
        kind: r.kind, count: 1, oldest_hours: r.age_hours,
      });
    }
  }
  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Stuck Pending table
// ---------------------------------------------------------------------------

function StuckPendingTable({ records }: { records: StuckRecord[] }) {
  const router = useRouter();
  const [ageFilter, setAgeFilter] = useState<AgeFilter>('1h');
  const [kindFilter, setKindFilter] = useState<'all' | 'metered' | 'non-metered'>('all');
  const [sortCol, setSortCol] = useState<'age' | 'client' | 'count'>('age');
  const [sortAsc, setSortAsc] = useState(false);

  const minHours = AGE_FILTER_OPTIONS.find((o) => o.value === ageFilter)?.minHours ?? 0;

  const filtered = records
    .filter((r) => r.age_hours >= minHours)
    .filter((r) => kindFilter === 'all' || r.kind === kindFilter);

  const grouped = useMemo(
    () => groupRecords(filtered).sort((a, b) => {
      let diff = 0;
      if (sortCol === 'age')    diff = b.oldest_hours - a.oldest_hours;
      if (sortCol === 'client') diff = a.client_name.localeCompare(b.client_name);
      if (sortCol === 'count')  diff = b.count - a.count;
      return sortAsc ? -diff : diff;
    }),
    [filtered, sortCol, sortAsc]
  );

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortAsc((p) => !p);
    else { setSortCol(col); setSortAsc(false); }
  }

  function SortIcon({ col }: { col: typeof sortCol }) {
    if (sortCol !== col) return <span className="text-gray-300 dark:text-gray-600 ml-1">↕</span>;
    return <span className="text-blue-500 ml-1">{sortAsc ? '↑' : '↓'}</span>;
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5">
          {AGE_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setAgeFilter(opt.value)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                ageFilter === opt.value
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5">
          {(['all', 'metered', 'non-metered'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${
                kindFilter === k
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {k === 'all' ? 'All types' : k}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-500 dark:text-gray-400 ml-auto">
          {filtered.length} record{filtered.length === 1 ? '' : 's'} across {grouped.length} location{grouped.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-amber-200 dark:bg-amber-900/60 inline-block" />
          Oldest pending &gt; 24h
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-red-200 dark:bg-red-900/60 inline-block" />
          Oldest pending &gt; 7 days
        </span>
        <span className="text-gray-400 dark:text-gray-600 hidden sm:inline">Click a row to open the client</span>
      </div>

      {grouped.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
          <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-3">
            <svg className="w-7 h-7 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-gray-600 dark:text-gray-300 font-medium">No stuck pending records</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            Everything is confirmed, errored, or recently seeded.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700">
                <th
                  className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 select-none whitespace-nowrap"
                  onClick={() => toggleSort('client')}
                >
                  Client <SortIcon col="client" />
                </th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">
                  Facility
                </th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap hidden md:table-cell">
                  Supplier
                </th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap hidden sm:table-cell">
                  Kind
                </th>
                <th
                  className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 select-none whitespace-nowrap hidden sm:table-cell"
                  onClick={() => toggleSort('count')}
                >
                  Pending <SortIcon col="count" />
                </th>
                <th
                  className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 select-none whitespace-nowrap"
                  onClick={() => toggleSort('age')}
                >
                  Oldest <SortIcon col="age" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {grouped.map((g) => (
                <tr
                  key={g.key}
                  onClick={() => router.push(`/clients/${g.client_id}`)}
                  className={`border-l-4 cursor-pointer transition-all hover:shadow-md hover:-translate-y-px ${ageRowClass(g.oldest_hours)}`}
                >
                  <td className="px-4 py-3 font-medium text-blue-600 dark:text-blue-400">
                    {g.client_name}
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    {g.facility_name ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 hidden md:table-cell">
                    {g.supplier_name ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      g.kind === 'metered'
                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                        : g.kind === 'non-metered'
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                    }`}>
                      {g.kind}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center hidden sm:table-cell">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs font-bold">
                      {g.count}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold tabular-nums ${ageBadgeClass(g.oldest_hours)}`}>
                      {formatAge(g.oldest_hours)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event Log
// ---------------------------------------------------------------------------

const EVENT_CATEGORY_OPTIONS: { label: string; value: EventCategory }[] = [
  { label: 'All events',     value: 'all'            },
  { label: 'Pending seeds',  value: 'pending'        },
  { label: 'Confirms',       value: 'confirm'        },
  { label: 'Errors',         value: 'error'          },
  { label: 'Inferred empty', value: 'inferred-empty' },
];

type OutcomeFilter = 'ALL' | 'SUCCESS' | 'FAILURE';

function endpointLabel(endpoint: string): string {
  const map: Record<string, string> = {
    'confirm':          'confirm',
    'metered/confirm':  'metered/confirm',
    'unified-confirm':  'unified-confirm',
    'pending':          'pending',
    'metered/pending':  'metered/pending',
    'error':            'error',
    'metered/error':    'metered/error',
    'inferred-empty':   'inferred-empty',
  };
  return map[endpoint] ?? endpoint;
}

function EventLogPanel({ refreshKey }: { refreshKey: number }) {
  const [events, setEvents] = useState<IngestionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('FAILURE');
  const [categoryFilter, setCategoryFilter] = useState<EventCategory>('all');

  const buildUrl = useCallback((before?: string | null) => {
    const params = new URLSearchParams();
    params.set('limit', '500');
    if (before) params.set('before', before);
    return `/api/activity?${params.toString()}`;
  }, []);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(), { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load activity');
      setEvents(json.data ?? []);
      setNextCursor(json.nextCursor ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity');
      setEvents([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(buildUrl(nextCursor), { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load more');
      setEvents((prev) => [...prev, ...(json.data ?? [])]);
      setNextCursor(json.nextCursor ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  }, [buildUrl, nextCursor]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents, refreshKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter((e) => {
      if (outcomeFilter !== 'ALL' && e.outcome !== outcomeFilter) return false;
      if (categoryFilter !== 'all' && endpointCategory(e.endpoint) !== categoryFilter) return false;
      if (q) {
        const haystack = [
          eventClientName(e),
          e.supplier_name,
          e.facility_name,
          e.utility_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [events, search, outcomeFilter, categoryFilter]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-20 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 mx-auto rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12A9 9 0 113 12a9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Unable to load activity</h3>
        <p className="mt-1 text-gray-500 dark:text-gray-400 max-w-sm mx-auto">{error}</p>
        <button
          onClick={fetchEvents}
          className="mt-6 bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 font-medium transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-col gap-3 mb-5">
        {/* Row 1: search + outcome */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search client, supplier…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                ×
              </button>
            )}
          </div>

          {/* Outcome filter */}
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5">
            {(['ALL', 'SUCCESS', 'FAILURE'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setOutcomeFilter(v)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  outcomeFilter === v
                    ? v === 'FAILURE'
                      ? 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                      : v === 'SUCCESS'
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {v === 'ALL' ? 'All outcomes' : v === 'SUCCESS' ? 'Success' : 'Failed'}
              </button>
            ))}
          </div>

          <span className="text-sm text-gray-500 dark:text-gray-400 ml-auto">
            {filtered.length} event{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Row 2: event category filter */}
        <div className="flex flex-wrap gap-1.5">
          {EVENT_CATEGORY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setCategoryFilter(opt.value)}
              className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                categoryFilter === opt.value
                  ? 'bg-gray-800 text-white border-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500 bg-white dark:bg-gray-800'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
          <p className="text-gray-500 dark:text-gray-400 font-medium">No events match your filters</p>
          <button
            onClick={() => { setSearch(''); setOutcomeFilter('ALL'); setCategoryFilter('all'); }}
            className="mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((ev) => {
            const isFailure = ev.outcome === 'FAILURE';
            const isSuccess = ev.outcome === 'SUCCESS';
            return (
              <div
                key={ev.id}
                className={`rounded-xl border bg-white dark:bg-gray-800 p-4 shadow-sm ${
                  isFailure
                    ? 'border-red-200 dark:border-red-900/50'
                    : 'border-gray-100 dark:border-gray-700'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Outcome badge */}
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                        isFailure
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                          : isSuccess
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                      }`}>
                        {isFailure ? 'Failed' : 'Success'}
                      </span>
                      {/* Endpoint badge */}
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 font-mono">
                        {endpointLabel(ev.endpoint)}
                      </span>
                      {/* Client link */}
                      {ev.client_id ? (
                        <Link href={`/clients/${ev.client_id}`} className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">
                          {eventClientName(ev)}
                        </Link>
                      ) : (
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{eventClientName(ev)}</span>
                      )}
                    </div>

                    {/* Detail line */}
                    <div className="mt-1 text-sm text-gray-600 dark:text-gray-300 truncate">
                      {[ev.facility_name, ev.supplier_name, ev.utility_name].filter(Boolean).join(' · ') || (
                        <span className="text-gray-400 italic">No facility / supplier context</span>
                      )}
                      {ev.period_start && (
                        <span className="text-gray-400 dark:text-gray-500"> · {formatPeriod(ev.period_start)}</span>
                      )}
                      {typeof ev.affected_count === 'number' && (
                        <span className="text-gray-400 dark:text-gray-500">
                          {' · '}{ev.affected_count} record{ev.affected_count === 1 ? '' : 's'} {isFailure ? 'affected' : 'confirmed'}
                        </span>
                      )}
                    </div>

                    {/* Failure reason */}
                    {isFailure && ev.reason && (
                      <div className="mt-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded-md px-3 py-1.5 break-words">
                        {ev.reason}
                        {ev.http_status && (
                          <span className="text-red-400 dark:text-red-500 ml-1">(HTTP {ev.http_status})</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="text-right flex-shrink-0">
                    <div
                      className="text-xs text-gray-500 dark:text-gray-400"
                      title={formatAbsolute(ev.created_at)}
                    >
                      {formatRelative(ev.created_at)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {nextCursor && (
        <div className="flex justify-center mt-6">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'stuck' | 'log';

export default function IngestionOverviewPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('log');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      <header className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-100 dark:border-gray-800 sticky top-0 z-30">
        <div className="mx-auto px-4 sm:px-6 lg:px-10 max-w-[1600px]">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                title="Back to clients"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Ingestion Overview</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRefreshKey((k) => k + 1)}
                className="px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-sm font-medium flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="hidden sm:inline">Refresh</span>
              </button>
              <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />
              <button
                type="button"
                onClick={async () => {
                  const supabase = createSupabaseBrowserClient();
                  await supabase.auth.signOut();
                  router.push('/login');
                  router.refresh();
                }}
                className="px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-sm font-medium"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-500" />

      <main className="mx-auto px-4 sm:px-6 lg:px-10 max-w-[1600px] py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Ingestion Overview</h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Monitor pending records and confirm/error events across all clients.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab('log')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border border-b-0 transition-colors -mb-px ${
              activeTab === 'log'
                ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Event Log
          </button>
          <button
            onClick={() => setActiveTab('stuck')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border border-b-0 transition-colors -mb-px ${
              activeTab === 'stuck'
                ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Stuck Pending
          </button>
        </div>

        {activeTab === 'stuck' ? (
          <StuckPendingTable records={DUMMY_STUCK} />
        ) : (
          <EventLogPanel refreshKey={refreshKey} />
        )}
      </main>
    </div>
  );
}
