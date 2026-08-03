/**
 * Classifies rows from p1EmailStaging into the dashboard's three buckets.
 *
 * Ported from the n8n "Analysis" node, with two deliberate corrections and one
 * structural change:
 *
 *   1. `Pending` + `Completed` is a success. n8n has this right in code, but the
 *      emailed report evidently did not — the example workbook annotates several
 *      such rows with "Old report wrongly flagged this as an error."
 *   2. Ignored attachments are recognised by filename as well as status text.
 *      n8n only tests `Completed` against /inline image|loa/i, which misses the
 *      cover pages and stray .docx files the example workbook classifies as
 *      ignorable.
 *   3. n8n's seven buckets (plus an `unknown` catch-all) collapse to three, so
 *      the headline numbers always add up to the total received. Unrecognised
 *      states land in `action_needed` with their raw values preserved in the
 *      comment, rather than vanishing into a bucket nobody reads.
 */

import type { IntakeBucket, IntakeFileRow } from '@/types';
import { parseSheetTime } from './dates';

export interface StagingRow {
  row_number?: number | string;
  Client?: string;
  AttachmentName?: string;
  AttachmentID?: string;
  Time?: string;
  Processed?: string;
  Completed?: string;
  Category?: string;
  'Input Type'?: string;
  'Issue Resolved'?: string;
  [key: string]: unknown;
}

export interface Classification {
  bucket: IntakeBucket;
  detail: string;
  comment: string;
  owner: string;
}

const OWNER_DEV = 'Dev to check';
const OWNER_DATA = 'Data team';

/** Shown when the Client cell is blank, matching the example workbook. */
export const UNASSIGNED_CUSTOMER = '(unassigned)';

/**
 * Attachments that are never data files.
 *
 * Seeded from the example workbook, where these arrive as supplier cover pages
 * attached alongside the real data. This list is the least certain part of the
 * classifier — it is a filename heuristic standing in for a signal the sheet
 * does not record. Validate it against real staging rows before trusting the
 * Ignored count, and prefer adding to `Completed`-based detection upstream over
 * growing this list.
 */
const COVER_ATTACHMENT_FILENAMES = new Set(['agl.pdf']);

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|bmp|webp|tiff?|svg)$/i;
const DOC_EXTENSIONS = /\.(docx?|odt|rtf)$/i;

/** "Completed with Facility flag" → "Facility flag"; "Completed with  flag" → "Flag". */
const FLAG_PATTERN = /completed\s+with\s*(.*?)\s*\bflag\b/i;

/** Tracker/API failures recorded as an HTTP status prefix. */
const HTTP_ERROR_PREFIX = /^(\d{3})\b/;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function fileNameOf(row: StagingRow): string {
  return text(row.AttachmentName) || text(row.AttachmentID);
}

/**
 * Identifies non-data attachments, returning the display label or null.
 *
 * Status text is checked first because it is what the pipeline actually
 * recorded; the filename rules are a fallback for rows the pipeline let through
 * without a note.
 */
function ignoredDetail(row: StagingRow): string | null {
  const completed = text(row.Completed);
  const fileName = fileNameOf(row);

  if (/inline\s*image/i.test(completed)) return 'Inline image';
  if (/\bloa\b/i.test(completed)) return 'LOA document';

  if (IMAGE_EXTENSIONS.test(fileName)) return 'Inline image';
  if (DOC_EXTENSIONS.test(fileName)) return 'Non-data doc';
  if (COVER_ATTACHMENT_FILENAMES.has(fileName.toLowerCase())) return 'Cover attachment';

  return null;
}

/**
 * Maps one staging row to a bucket.
 *
 * Rule order is load-bearing: ignored attachments and flagged files are both
 * checked before the generic Processed/Completed rules, because a flagged file
 * is also `Processed` and would otherwise be counted as done.
 */
export function classifyStagingRow(row: StagingRow): Classification {
  const processed = text(row.Processed);
  const completed = text(row.Completed);

  const ignored = ignoredDetail(row);
  if (ignored) {
    return {
      bucket: 'ignored',
      detail: ignored,
      comment: 'Non-data attachment. Excluded by design.',
      owner: '',
    };
  }

  const flag = completed.match(FLAG_PATTERN);
  if (flag) {
    const kind = flag[1].trim();
    const label = kind ? `${kind[0].toUpperCase()}${kind.slice(1)} flag` : 'Flag';
    return {
      bucket: 'action_needed',
      detail: label,
      comment: 'Processed and in the tracker, but the flagged details need confirming.',
      owner: OWNER_DATA,
    };
  }

  if (processed === 'Processed' && completed === 'Completed') {
    return {
      bucket: 'done',
      detail: 'Fully processed',
      comment: 'Processed and entered into the data tracker.',
      owner: '',
    };
  }

  // The correction: Pending here means the categorisation step never flipped the
  // field, but Completed proves the file made it through. n8n's emailed report
  // counted these as errors.
  if ((processed === 'Pending' || processed === 'Completed') && completed === 'Completed') {
    return {
      bucket: 'done',
      detail: 'Completed',
      comment: 'Finished successfully (both status fields report completion).',
      owner: '',
    };
  }

  if (processed === 'Processed') {
    const httpError = completed.match(HTTP_ERROR_PREFIX);
    if (httpError) {
      const status = httpError[1];
      if (status === '404') {
        return {
          bucket: 'action_needed',
          detail: 'Not found',
          comment: "The account this file points to doesn't exist in the system.",
          owner: OWNER_DEV,
        };
      }
      return {
        bucket: 'action_needed',
        detail: 'Tracker not updated',
        comment: `Output was sent but the data tracker returned HTTP ${status}. The entry is missing from the tracker.`,
        owner: OWNER_DEV,
      };
    }

    if (completed === '') {
      return {
        bucket: 'action_needed',
        detail: 'Lost in workflow',
        comment: 'Reached the Processed state but produced no output. Likely an upstream workflow issue.',
        owner: OWNER_DEV,
      };
    }
  }

  if (processed === 'Pending' && completed === '') {
    return {
      bucket: 'action_needed',
      detail: 'Stuck (Pending)',
      comment: 'Never got sorted into a category - sitting in the queue.',
      owner: OWNER_DEV,
    };
  }

  if (processed === 'Error') {
    const unclassified = /unclassified/i.test(completed);
    return {
      bucket: 'action_needed',
      detail: unclassified ? 'Unclassified' : 'Unrecognised data',
      comment: unclassified
        ? "System couldn't work out what type of file this is."
        : `Recorded as an error: ${completed || 'no message captured'}.`,
      owner: OWNER_DEV,
    };
  }

  if (processed === '' && completed === '') {
    return {
      bucket: 'action_needed',
      detail: 'Not processed',
      comment: 'Came in but nothing happened to it - no status recorded at all.',
      owner: OWNER_DEV,
    };
  }

  // Deliberately action_needed rather than a fourth bucket, so the totals still
  // sum. The raw values go in the comment so the gap is visible and fixable.
  return {
    bucket: 'action_needed',
    detail: 'Unrecognised status',
    comment: `Unexpected combination — Processed: "${processed}", Completed: "${completed}".`,
    owner: OWNER_DEV,
  };
}

/** Builds the dashboard row for one staging record. */
export function toIntakeFileRow(row: StagingRow): IntakeFileRow {
  const classification = classifyStagingRow(row);
  const time = parseSheetTime(row.Time);

  return {
    rowNumber: Number(row.row_number ?? 0),
    bucket: classification.bucket,
    customer: text(row.Client) || UNASSIGNED_CUSTOMER,
    fileName: fileNameOf(row) || 'unnamed',
    category: text(row.Category),
    inputType: text(row['Input Type']),
    detail: classification.detail,
    comment: classification.comment,
    owner: classification.owner,
    issueResolved: /^y(es)?$/i.test(text(row['Issue Resolved'])),
    time: time ? time.toISOString() : null,
  };
}
