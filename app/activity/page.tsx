'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { IngestionEvent } from '@/types';

type OutcomeFilter = 'FAILURE' | 'ALL';

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPeriod(period: string | null): string | null {
  if (!period) return null;
  const m = period.match(/^(\d{4})-(\d{2})/);
  if (!m) return period;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function eventClientName(ev: IngestionEvent): string {
  // Supabase may return the joined relation as an object or a single-element array.
  const joined = ev.client as { name?: string } | { name?: string }[] | null | undefined;
  const joinedName = Array.isArray(joined) ? joined[0]?.name : joined?.name;
  return joinedName ?? ev.client_name ?? 'Unknown client';
}

function eventTarget(ev: IngestionEvent): string {
  const parts = [ev.facility_name, ev.supplier_name, ev.utility_name].filter(Boolean);
  return parts.join(' · ') || '—';
}

export default function ActivityPage() {
  const router = useRouter();
  const [events, setEvents] = useState<IngestionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<OutcomeFilter>('FAILURE');
  const [clients, setClients] = useState<{ id: number; name: string }[]>([]);
  const [clientId, setClientId] = useState<string>('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const buildUrl = useCallback(
    (before?: string | null) => {
      const params = new URLSearchParams();
      if (outcome === 'FAILURE') params.set('outcome', 'FAILURE');
      if (clientId) params.set('clientId', clientId);
      if (before) params.set('before', before);
      params.set('limit', '100');
      return `/api/activity?${params.toString()}`;
    },
    [outcome, clientId]
  );

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
  }, [fetchEvents]);

  useEffect(() => {
    fetch('/api/clients')
      .then((r) => r.json())
      .then((j) => {
        const list = Array.isArray(j?.data)
          ? j.data.map((d: { client: { id: number; name: string } }) => d.client)
          : [];
        setClients(list);
      })
      .catch(() => {});
  }, []);

  const failureCount = events.filter((e) => e.outcome === 'FAILURE').length;

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
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Ingestion Activity</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchEvents}
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
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {outcome === 'FAILURE' ? 'Failed & reported ingestion attempts' : 'Recent ingestion attempts'}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Confirm and error events across all your clients, most recent first.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5">
            <button
              onClick={() => setOutcome('FAILURE')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                outcome === 'FAILURE'
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              Failures only
            </button>
            <button
              onClick={() => setOutcome('ALL')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                outcome === 'ALL'
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              All activity
            </button>
          </div>

          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>

          {!loading && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {outcome === 'FAILURE'
                ? `${events.length} failure${events.length === 1 ? '' : 's'}`
                : `${events.length} event${events.length === 1 ? '' : 's'} (${failureCount} failed)`}
            </span>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-16 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 animate-pulse"
              />
            ))}
          </div>
        ) : error ? (
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
        ) : events.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {outcome === 'FAILURE' ? 'No failures to show' : 'No activity yet'}
            </h3>
            <p className="mt-1 text-gray-500 dark:text-gray-400 max-w-md mx-auto">
              {outcome === 'FAILURE'
                ? 'Nothing has failed recently. Events appear here as confirms run.'
                : 'Confirm and error events will appear here once ingestion runs.'}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2.5">
              {events.map((ev) => {
                const isFailure = ev.outcome === 'FAILURE';
                const period = formatPeriod(ev.period_start);
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
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                              isFailure
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            }`}
                          >
                            {isFailure ? 'Failed' : 'Confirmed'}
                          </span>
                          <span className="text-xs font-mono text-gray-400 dark:text-gray-500">
                            {ev.endpoint}
                          </span>
                          {ev.client_id ? (
                            <Link
                              href={`/clients/${ev.client_id}`}
                              className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline truncate"
                            >
                              {eventClientName(ev)}
                            </Link>
                          ) : (
                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                              {eventClientName(ev)}
                            </span>
                          )}
                        </div>

                        <div className="mt-1 text-sm text-gray-600 dark:text-gray-300 truncate">
                          {eventTarget(ev)}
                          {period && (
                            <span className="text-gray-400 dark:text-gray-500"> · {period}</span>
                          )}
                          {typeof ev.affected_count === 'number' && !isFailure && (
                            <span className="text-gray-400 dark:text-gray-500">
                              {' '}
                              · {ev.affected_count} record{ev.affected_count === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>

                        {isFailure && ev.reason && (
                          <div className="mt-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded-md px-3 py-1.5 break-words">
                            {ev.reason}
                            {ev.http_status ? (
                              <span className="text-red-400 dark:text-red-500"> (HTTP {ev.http_status})</span>
                            ) : null}
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
          </>
        )}
      </main>
    </div>
  );
}
