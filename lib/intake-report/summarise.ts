/**
 * Aggregation for the two dashboard tabs.
 *
 * Kept apart from the classifiers so both stay independently testable — the
 * classifiers decide what a row *is*, these functions only count.
 */

import type {
  IntakeCustomerSummary,
  IntakeFileRow,
  IntakeReportPayload,
  OpenIssue,
  OpenIssuesPayload,
} from '@/types';
import { formatWeekEnding } from './dates';

/**
 * Rows are sorted with the ones needing attention first, then done, then
 * ignored — the order someone actually reads the table in.
 *
 * Within `action_needed`, "Dev to check" outranks "Data team" because that
 * bucket now mixes hard failures with flagged-but-processed files. Without this
 * the genuinely broken files get buried among the merely flagged ones, which is
 * the one thing collapsing the old "Needs review" bucket risked costing us.
 */
const BUCKET_ORDER: Record<IntakeFileRow['bucket'], number> = {
  action_needed: 0,
  done: 1,
  ignored: 2,
};

const OWNER_ORDER: Record<string, number> = {
  'Dev to check': 0,
  'Data team': 1,
};

export function sortFileRows(files: IntakeFileRow[]): IntakeFileRow[] {
  return [...files].sort((a, b) => {
    const bucket = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
    if (bucket !== 0) return bucket;

    const owner = (OWNER_ORDER[a.owner] ?? 9) - (OWNER_ORDER[b.owner] ?? 9);
    if (owner !== 0) return owner;

    return a.rowNumber - b.rowNumber;
  });
}

function emptySummary(customer: string): IntakeCustomerSummary {
  return { customer, files: 0, done: 0, actionNeeded: 0, ignored: 0 };
}

/** Per-customer counts, busiest first — matching the example workbook's ordering. */
export function summariseByCustomer(files: IntakeFileRow[]): IntakeCustomerSummary[] {
  const byCustomer = new Map<string, IntakeCustomerSummary>();

  for (const file of files) {
    let entry = byCustomer.get(file.customer);
    if (!entry) {
      entry = emptySummary(file.customer);
      byCustomer.set(file.customer, entry);
    }

    entry.files += 1;
    if (file.bucket === 'done') entry.done += 1;
    else if (file.bucket === 'action_needed') entry.actionNeeded += 1;
    else entry.ignored += 1;
  }

  return Array.from(byCustomer.values()).sort(
    (a, b) => b.files - a.files || a.customer.localeCompare(b.customer),
  );
}

/**
 * Builds the "This Week" payload.
 *
 * The bucket counts are derived in one pass here rather than trusted from
 * elsewhere, so `done + actionNeeded + ignored === received` holds by
 * construction.
 */
export function buildIntakeReport(
  weekKey: string,
  files: IntakeFileRow[],
): Omit<IntakeReportPayload, 'configured'> {
  const sorted = sortFileRows(files);

  return {
    weekKey,
    weekEndingLabel: formatWeekEnding(weekKey),
    totals: {
      received: sorted.length,
      done: sorted.filter((f) => f.bucket === 'done').length,
      actionNeeded: sorted.filter((f) => f.bucket === 'action_needed').length,
      ignored: sorted.filter((f) => f.bucket === 'ignored').length,
    },
    byCustomer: summariseByCustomer(sorted),
    files: sorted,
  };
}

function countBy<T>(items: T[], key: (item: T) => string): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = key(item);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Builds the "Open Issues" payload.
 *
 * Only open tickets are counted and returned — closed ones are history, and the
 * point of this tab is the backlog. Oldest first, because age is the signal
 * that something has stalled.
 */
export function buildOpenIssues(issues: OpenIssue[]): Omit<OpenIssuesPayload, 'configured'> {
  const open = issues
    .filter((issue) => issue.isOpen)
    .sort((a, b) => b.ageDays - a.ageDays || a.rowInStaging - b.rowInStaging);

  return {
    totals: {
      open: open.length,
      awaitingRerun: open.filter((issue) => issue.rerunRequested).length,
      oldestAgeDays: open.reduce((max, issue) => Math.max(max, issue.ageDays), 0),
    },
    byErrorType: countBy(open, (issue) => issue.errorType).map(({ label, count }) => ({
      errorType: label,
      count,
    })),
    byOwner: countBy(open, (issue) => issue.owner ?? 'Unassigned').map(({ label, count }) => ({
      owner: label,
      count,
    })),
    issues: open,
  };
}
