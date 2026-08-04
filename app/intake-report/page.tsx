'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatPerthDate } from '@/lib/intake-report/dates';
import type {
  IntakeBucket,
  IntakeFileRow,
  IntakeReportPayload,
  OpenIssue,
  OpenIssuesPayload,
} from '@/types';

// ---------------------------------------------------------------------------
// Shared presentation
// ---------------------------------------------------------------------------

/**
 * Status colours are reserved: emerald means done, red means someone must act,
 * gray means deliberately excluded. They mean the same thing on both tabs, and
 * every use is paired with a text label so nothing is conveyed by colour alone.
 */
const BUCKET_LABEL: Record<IntakeBucket, string> = {
  done: 'Done',
  action_needed: 'Action needed',
  ignored: 'Ignored',
};

const BUCKET_TEXT: Record<IntakeBucket, string> = {
  done: 'text-emerald-600',
  action_needed: 'text-red-600',
  ignored: 'text-gray-500',
};

const BUCKET_BADGE: Record<IntakeBucket, string> = {
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  action_needed: 'bg-red-50 text-red-700 border-red-200',
  ignored: 'bg-gray-100 text-gray-600 border-gray-200',
};

/** Matches the age convention already used on the Ingestion Overview page. */
function ageBadgeClass(days: number): string {
  if (days >= 14) return 'bg-red-100 text-red-700';
  if (days >= 7) return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-600';
}

function StatTile({
  value,
  label,
  tone = 'text-gray-900',
  active = false,
  onClick,
  hint,
  loading = false,
}: {
  value: number | string;
  label: string;
  tone?: string;
  active?: boolean;
  onClick?: () => void;
  hint?: string;
  loading?: boolean;
}) {
  const base =
    'bg-white rounded-xl p-4 border shadow-sm text-left transition-colors w-full';
  const state = active
    ? 'border-blue-400 ring-2 ring-blue-100'
    : 'border-gray-100 hover:border-gray-200';

  const body = loading ? (
    <div className="h-8 w-12 bg-gray-200 rounded animate-pulse mb-1" />
  ) : (
    <div className={`text-2xl font-bold ${tone}`}>{value}</div>
  );

  if (!onClick) {
    return (
      <div className={`${base} border-gray-100`}>
        {body}
        <div className="text-sm text-gray-500">{label}</div>
        {hint && <div className="text-xs text-gray-400 mt-0.5">{hint}</div>}
      </div>
    );
  }

  return (
    <button type="button" onClick={onClick} className={`${base} ${state}`} aria-pressed={active}>
      {body}
      <div className="text-sm text-gray-500">{label}</div>
      {hint && <div className="text-xs text-gray-400 mt-0.5">{hint}</div>}
    </button>
  );
}

function TableSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="h-12 bg-gray-50 animate-pulse" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-14 border-t border-gray-100 bg-white animate-pulse" />
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="text-center py-16">
      <div className="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12A9 9 0 113 12a9 9 0 0118 0z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-gray-900">Something went wrong</h3>
      <p className="mt-1 text-gray-500 max-w-sm mx-auto">{message}</p>
      <button
        onClick={onRetry}
        className="mt-6 bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 font-medium transition-colors"
      >
        Try Again
      </button>
    </div>
  );
}

/**
 * Shown when the Google credentials are absent. This is a normal state, not a
 * failure — the dashboard ships before the service account does.
 */
function NotConfigured() {
  return (
    <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
      <div className="w-14 h-14 mx-auto rounded-full bg-blue-50 flex items-center justify-center mb-3">
        <svg className="w-7 h-7 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <p className="text-gray-700 font-medium">Google Sheets isn&apos;t connected yet</p>
      <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
        Set <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">GOOGLE_SERVICE_ACCOUNT_EMAIL</code>{' '}
        and <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">GOOGLE_PRIVATE_KEY</code>, then
        share both sheets with the service account as Viewer. See{' '}
        <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">.env.local.example</code>.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab A — This Week
// ---------------------------------------------------------------------------

/** Client-side week shifting, so the arrows don't wait on a round trip to know the key. */
function shiftWeekKey(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + delta * 7 * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function ThisWeekTab({ refreshKey }: { refreshKey: number }) {
  const [weekKey, setWeekKey] = useState<string | null>(null);
  const [data, setData] = useState<IntakeReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [bucketFilter, setBucketFilter] = useState<IntakeBucket | 'all'>('all');
  const [customerFilter, setCustomerFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hideResolved, setHideResolved] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchReport = useCallback(
    async (week: string | null, opts: { refresh?: boolean } = {}) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (week) params.set('week', week);
        if (opts.refresh) params.set('refresh', 'true');

        const response = await fetch(`/api/intake-report?${params.toString()}`, {
          cache: 'no-store',
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json?.error ?? 'Failed to load the report');

        setData(json as IntakeReportPayload);
        setWeekKey((json as IntakeReportPayload).weekKey);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load the report');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchReport(weekKey, { refresh: refreshKey > 0 });
    // weekKey is intentionally omitted: it is set *by* the fetch, and including
    // it would re-fire the request on every response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const goToWeek = (delta: number) => {
    if (!weekKey) return;
    const next = shiftWeekKey(weekKey, delta);
    setWeekKey(next);
    fetchReport(next);
  };

  const isCurrentWeek = useMemo(() => {
    if (!weekKey) return true;
    const now = new Date();
    // Perth is UTC+8; the same maths the server uses.
    const perth = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const dow = perth.getUTCDay();
    const monday = new Date(
      Date.UTC(perth.getUTCFullYear(), perth.getUTCMonth(), perth.getUTCDate()) -
        ((dow + 6) % 7) * 24 * 60 * 60 * 1000,
    );
    const pad = (n: number) => String(n).padStart(2, '0');
    const key = `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
    return weekKey >= key;
  }, [weekKey]);

  const visibleFiles = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();

    return data.files.filter((file) => {
      if (bucketFilter !== 'all' && file.bucket !== bucketFilter) return false;
      if (customerFilter && file.customer !== customerFilter) return false;
      if (hideResolved && file.issueResolved) return false;
      if (!needle) return true;

      return (
        file.fileName.toLowerCase().includes(needle) ||
        file.customer.toLowerCase().includes(needle) ||
        file.detail.toLowerCase().includes(needle) ||
        String(file.rowNumber).includes(needle)
      );
    });
  }, [data, bucketFilter, customerFilter, search, hideResolved]);

  const anyResolved = useMemo(
    () => (data?.files ?? []).some((f) => f.issueResolved),
    [data],
  );

  const clearFilters = () => {
    setBucketFilter('all');
    setCustomerFilter(null);
    setSearch('');
    setHideResolved(false);
  };

  const hasFilters =
    bucketFilter !== 'all' || customerFilter !== null || search.trim() !== '' || hideResolved;

  /**
   * Rebuilds the two-sheet workbook the weekly email attaches, so the dashboard
   * is a drop-in replacement for people who work from the spreadsheet.
   */
  const handleExport = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const XLSX = await import('xlsx');

      const summary = [
        ['Weekly Data Intake Report'],
        [data.weekEndingLabel],
        [],
        ['THE WEEK AT A GLANCE'],
        [],
        [data.totals.received, data.totals.done, data.totals.actionNeeded, data.totals.ignored],
        ['Files received', 'Done', 'Action needed', 'Ignored'],
        [],
        ['Buckets add up to the total received.'],
        [],
        ['BY CUSTOMER'],
        ['Customer', 'Files', 'Done', 'Action needed', 'Ignored'],
        ...data.byCustomer.map((c) => [c.customer, c.files, c.done, c.actionNeeded, c.ignored]),
        [
          'TOTAL',
          data.totals.received,
          data.totals.done,
          data.totals.actionNeeded,
          data.totals.ignored,
        ],
      ];

      const allFiles = [
        [`All files that went through this week (${data.totals.received})`],
        [],
        ['Row', 'Status', 'Customer', 'Supplier', 'Category', 'Input Type', 'File name', 'Detail', 'Last updated', 'Comment', 'Owner / next step'],
        ...data.files.map((f) => [
          f.rowNumber,
          BUCKET_LABEL[f.bucket],
          f.customer,
          f.supplier,
          f.category,
          f.inputType,
          f.fileName,
          f.detail,
          formatLastUpdated(f),
          f.comment,
          f.owner,
        ]),
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), 'Summary');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(allFiles), 'All Files');
      XLSX.writeFile(workbook, `Weekly-Data-Intake-Report-${data.weekKey}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  if (error) {
    return <ErrorState message={error} onRetry={() => fetchReport(weekKey)} />;
  }

  if (data && !data.configured) {
    return <NotConfigured />;
  }

  return (
    <div>
      {/* Week picker */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white">
          <button
            onClick={() => goToWeek(-1)}
            disabled={loading || !weekKey}
            className="px-3 py-2 text-gray-500 hover:text-gray-800 hover:bg-gray-50 rounded-l-lg transition-colors disabled:opacity-40"
            title="Previous week"
            aria-label="Previous week"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="px-4 py-2 text-sm font-medium text-gray-900 min-w-[16rem] text-center">
            {loading && !data ? 'Loading…' : data?.weekEndingLabel ?? '—'}
          </span>
          <button
            onClick={() => goToWeek(1)}
            disabled={loading || isCurrentWeek}
            className="px-3 py-2 text-gray-500 hover:text-gray-800 hover:bg-gray-50 rounded-r-lg transition-colors disabled:opacity-40"
            title={isCurrentWeek ? 'Already at the current week' : 'Next week'}
            aria-label="Next week"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {!isCurrentWeek && (
          <button
            onClick={() => {
              setWeekKey(null);
              fetchReport(null);
            }}
            className="px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          >
            This week
          </button>
        )}

        <button
          onClick={handleExport}
          disabled={!data || exporting || data.totals.received === 0}
          className="ml-auto px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40 flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {exporting ? 'Exporting…' : 'Export XLSX'}
        </button>
      </div>

      {/* At a glance */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatTile
          value={data?.totals.received ?? 0}
          label="Files received"
          active={bucketFilter === 'all'}
          onClick={() => setBucketFilter('all')}
          loading={loading && !data}
        />
        <StatTile
          value={data?.totals.done ?? 0}
          label={BUCKET_LABEL.done}
          tone={BUCKET_TEXT.done}
          active={bucketFilter === 'done'}
          onClick={() => setBucketFilter('done')}
          loading={loading && !data}
        />
        <StatTile
          value={data?.totals.actionNeeded ?? 0}
          label={BUCKET_LABEL.action_needed}
          tone={BUCKET_TEXT.action_needed}
          active={bucketFilter === 'action_needed'}
          onClick={() => setBucketFilter('action_needed')}
          loading={loading && !data}
        />
        <StatTile
          value={data?.totals.ignored ?? 0}
          label={BUCKET_LABEL.ignored}
          tone={BUCKET_TEXT.ignored}
          active={bucketFilter === 'ignored'}
          onClick={() => setBucketFilter('ignored')}
          hint="Non-data attachments"
          loading={loading && !data}
        />
      </div>

      {loading && !data ? (
        <TableSkeleton />
      ) : !data || data.totals.received === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
          <p className="text-gray-600 font-medium">No files this week</p>
          <p className="text-sm text-gray-400 mt-1">
            Nothing entered the ingestion pipeline in this window.
          </p>
        </div>
      ) : (
        <>
          {/* By customer */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">By customer</h3>
            <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Customer</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Files</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Done</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Action needed</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Ignored</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byCustomer.map((row) => (
                    <tr
                      key={row.customer}
                      onClick={() =>
                        setCustomerFilter(customerFilter === row.customer ? null : row.customer)
                      }
                      className={`border-t border-gray-100 cursor-pointer transition-colors ${
                        customerFilter === row.customer ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-4 py-2.5 font-medium text-gray-900">{row.customer}</td>
                      <td className="px-4 py-2.5 text-right text-gray-700">{row.files}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-600">{row.done || '—'}</td>
                      <td className="px-4 py-2.5 text-right text-red-600">{row.actionNeeded || '—'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{row.ignored || '—'}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                    <td className="px-4 py-2.5 text-gray-900">TOTAL</td>
                    <td className="px-4 py-2.5 text-right text-gray-900">{data.totals.received}</td>
                    <td className="px-4 py-2.5 text-right text-emerald-700">{data.totals.done}</td>
                    <td className="px-4 py-2.5 text-right text-red-700">{data.totals.actionNeeded}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{data.totals.ignored}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* All files */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <h3 className="text-sm font-semibold text-gray-700">All files</h3>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search file, customer, detail…"
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {anyResolved && (
              <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideResolved}
                  onChange={(e) => setHideResolved(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Hide resolved
              </label>
            )}
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="text-sm text-blue-600 hover:underline"
              >
                Clear filters
              </button>
            )}
            <span className="text-sm text-gray-500 ml-auto">
              {visibleFiles.length} of {data.totals.received} file
              {data.totals.received === 1 ? '' : 's'}
            </span>
          </div>

          {visibleFiles.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
              <p className="text-gray-600 font-medium">No files match these filters</p>
              <button onClick={clearFilters} className="mt-3 text-sm text-blue-600 hover:underline">
                Clear filters
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Row</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Customer</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Supplier</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap hidden lg:table-cell">Category</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap hidden lg:table-cell">Input type</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">File name</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Detail</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap hidden lg:table-cell">Last updated</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden xl:table-cell">Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleFiles.map((file) => (
                    <FileRow key={file.rowNumber} file={file} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * `Last Updated` for a table cell.
 *
 * Falls back to the raw cell when it won't parse, rather than showing an empty
 * dash for a value the sheet actually holds — a few older rows were hand-typed
 * with dashes ("04-10-2026") instead of the day-first format the n8n job writes.
 */
function formatLastUpdated(file: IntakeFileRow): string {
  if (file.lastUpdated) return formatPerthDate(new Date(file.lastUpdated));
  return file.lastUpdatedRaw || '—';
}

function FileRow({ file }: { file: IntakeFileRow }) {
  return (
    <tr className="border-t border-gray-100 bg-white hover:bg-gray-50 transition-colors">
      <td className="px-4 py-2.5 text-gray-400 tabular-nums">{file.rowNumber}</td>
      <td className="px-4 py-2.5">
        <span
          className={`inline-block px-2 py-0.5 text-xs font-medium rounded border ${BUCKET_BADGE[file.bucket]}`}
        >
          {BUCKET_LABEL[file.bucket]}
        </span>
      </td>
      <td className="px-4 py-2.5 text-gray-900 whitespace-nowrap">{file.customer}</td>
      <td
        className="px-4 py-2.5 text-gray-700 max-w-[14rem] truncate"
        title={file.supplier || undefined}
      >
        {file.supplier || '—'}
      </td>
      <td className="px-4 py-2.5 text-gray-500 hidden lg:table-cell whitespace-nowrap">
        {file.category || '—'}
      </td>
      <td className="px-4 py-2.5 text-gray-500 hidden lg:table-cell whitespace-nowrap">
        {file.inputType || '—'}
      </td>
      <td className="px-4 py-2.5 text-gray-700 max-w-xs truncate" title={file.fileName}>
        {file.fileName}
        {file.issueResolved && (
          <span className="ml-2 inline-block px-1.5 py-0.5 text-xs rounded bg-emerald-50 text-emerald-700">
            resolved
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{file.detail}</td>
      <td className="px-4 py-2.5 text-gray-500 hidden lg:table-cell whitespace-nowrap">
        {formatLastUpdated(file)}
      </td>
      <td className="px-4 py-2.5 text-gray-500 hidden xl:table-cell max-w-md">{file.comment}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Tab B — Open Issues
// ---------------------------------------------------------------------------

function OpenIssuesTab({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<OpenIssuesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [errorTypeFilter, setErrorTypeFilter] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
  const [rerunOnly, setRerunOnly] = useState(false);
  const [search, setSearch] = useState('');

  const fetchIssues = useCallback(async (opts: { refresh?: boolean } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (opts.refresh) params.set('refresh', 'true');

      const response = await fetch(`/api/open-issues?${params.toString()}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error ?? 'Failed to load open issues');

      setData(json as OpenIssuesPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load open issues');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIssues({ refresh: refreshKey > 0 });
  }, [refreshKey, fetchIssues]);

  const visibleIssues = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();

    return data.issues.filter((issue) => {
      if (errorTypeFilter && issue.errorType !== errorTypeFilter) return false;
      if (ownerFilter && (issue.owner ?? 'Unassigned') !== ownerFilter) return false;
      if (rerunOnly && !issue.rerunRequested) return false;
      if (!needle) return true;

      return (
        issue.fileName.toLowerCase().includes(needle) ||
        issue.client.toLowerCase().includes(needle) ||
        issue.errorType.toLowerCase().includes(needle) ||
        issue.supplier.toLowerCase().includes(needle) ||
        String(issue.rowInStaging).includes(needle)
      );
    });
  }, [data, errorTypeFilter, ownerFilter, rerunOnly, search]);

  const hasFilters = errorTypeFilter !== null || ownerFilter !== null || rerunOnly || search.trim() !== '';

  const clearFilters = () => {
    setErrorTypeFilter(null);
    setOwnerFilter(null);
    setRerunOnly(false);
    setSearch('');
  };

  if (error) {
    return <ErrorState message={error} onRetry={() => fetchIssues()} />;
  }

  if (data && !data.configured) {
    return <NotConfigured />;
  }

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <StatTile
          value={data?.totals.open ?? 0}
          label="Open tickets"
          tone={data && data.totals.open > 0 ? BUCKET_TEXT.action_needed : BUCKET_TEXT.done}
          loading={loading && !data}
        />
        <StatTile
          value={data?.totals.awaitingRerun ?? 0}
          label="Awaiting rerun"
          tone="text-amber-600"
          active={rerunOnly}
          onClick={() => setRerunOnly((v) => !v)}
          hint="Rerun ticked in the tracker"
          loading={loading && !data}
        />
        <StatTile
          value={data ? `${data.totals.oldestAgeDays}d` : '—'}
          label="Oldest open ticket"
          tone={
            !data || data.totals.oldestAgeDays < 7
              ? 'text-gray-900'
              : data.totals.oldestAgeDays < 14
                ? 'text-amber-600'
                : 'text-red-600'
          }
          loading={loading && !data}
        />
      </div>

      {loading && !data ? (
        <TableSkeleton />
      ) : !data || data.totals.open === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
          <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 flex items-center justify-center mb-3">
            <svg className="w-7 h-7 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-gray-600 font-medium">No open issues</p>
          <p className="text-sm text-gray-400 mt-1">
            Everything in the ticket tracker is closed.
          </p>
        </div>
      ) : (
        <>
          {/* Breakdown chips */}
          <div className="space-y-3 mb-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">
                Error type
              </span>
              {data.byErrorType.map((entry) => (
                <button
                  key={entry.errorType}
                  onClick={() =>
                    setErrorTypeFilter(errorTypeFilter === entry.errorType ? null : entry.errorType)
                  }
                  className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                    errorTypeFilter === entry.errorType
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {entry.errorType}
                  <span className="ml-1.5 text-gray-400">{entry.count}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">
                Owner
              </span>
              {data.byOwner.map((entry) => (
                <button
                  key={entry.owner}
                  onClick={() => setOwnerFilter(ownerFilter === entry.owner ? null : entry.owner)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                    ownerFilter === entry.owner
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {entry.owner}
                  <span className="ml-1.5 text-gray-400">{entry.count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search file, client, supplier…"
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {hasFilters && (
              <button onClick={clearFilters} className="text-sm text-blue-600 hover:underline">
                Clear filters
              </button>
            )}
            <span className="text-sm text-gray-500 ml-auto">
              {visibleIssues.length} of {data.totals.open} open
            </span>
          </div>

          {visibleIssues.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
              <p className="text-gray-600 font-medium">No issues match these filters</p>
              <button onClick={clearFilters} className="mt-3 text-sm text-blue-600 hover:underline">
                Clear filters
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Row</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Age</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Client</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">File</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Error type</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap hidden lg:table-cell">Supplier</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap hidden lg:table-cell">Utility</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Owner</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden xl:table-cell">Next step</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap"></th>
                  </tr>
                </thead>
                <tbody>
                  {/* Index is part of the key because the tracker can hold more
                      than one ticket for the same staging row. */}
                  {visibleIssues.map((issue, index) => (
                    <IssueRow key={`${issue.rowInStaging}-${index}`} issue={issue} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: OpenIssue }) {
  return (
    <tr className="border-t border-gray-100 bg-white hover:bg-gray-50 transition-colors">
      <td className="px-4 py-2.5 text-gray-400 tabular-nums">{issue.rowInStaging || '—'}</td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-700">
          {issue.status || 'Open'}
        </span>
        {issue.rerunRequested && (
          <span className="ml-1.5 inline-block px-2 py-0.5 text-xs font-medium rounded bg-amber-50 text-amber-700">
            rerun
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${ageBadgeClass(issue.ageDays)}`}>
          {issue.ageDays}d
        </span>
      </td>
      <td className="px-4 py-2.5 text-gray-900 whitespace-nowrap">{issue.client || '—'}</td>
      <td className="px-4 py-2.5 text-gray-700 max-w-xs truncate" title={issue.fileName}>
        {issue.fileName || '—'}
      </td>
      <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{issue.errorType}</td>
      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap hidden lg:table-cell">
        {issue.supplier || '—'}
      </td>
      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap hidden lg:table-cell">
        {issue.utility || '—'}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        {issue.owner ? (
          <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700">
            {issue.owner}
          </span>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-gray-500 hidden xl:table-cell max-w-md">
        {issue.nextStep || '—'}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        {issue.link && (
          <a
            href={issue.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 inline-flex"
            title="Open the n8n execution"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'week' | 'issues';

export default function IntakeReportPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('week');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-30">
        <div className="mx-auto px-4 sm:px-6 lg:px-10 max-w-[1600px]">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
                title="Back to clients"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold text-gray-900">Data Intake</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRefreshKey((k) => k + 1)}
                className="px-3 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors text-sm font-medium flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="hidden sm:inline">Refresh</span>
              </button>
              <div className="w-px h-6 bg-gray-200 mx-1" />
              <button
                type="button"
                onClick={async () => {
                  const supabase = createSupabaseBrowserClient();
                  await supabase.auth.signOut();
                  router.push('/login');
                  router.refresh();
                }}
                className="px-3 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors text-sm font-medium"
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
          <h2 className="text-2xl font-bold text-gray-900">Data Intake</h2>
          <p className="text-gray-500 mt-1">
            What came in this week, and what is still broken.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('week')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border border-b-0 transition-colors -mb-px ${
              activeTab === 'week'
                ? 'bg-white border-gray-200 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            This Week
          </button>
          <button
            onClick={() => setActiveTab('issues')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border border-b-0 transition-colors -mb-px ${
              activeTab === 'issues'
                ? 'bg-white border-gray-200 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Open Issues
          </button>
        </div>

        {activeTab === 'week' ? (
          <ThisWeekTab refreshKey={refreshKey} />
        ) : (
          <OpenIssuesTab refreshKey={refreshKey} />
        )}
      </main>
    </div>
  );
}
