/**
 * Parses rows from ticket_tracker_template / Tickets_Current.
 *
 * This sheet is where the team actually works errors — the daily n8n job
 * appends a ticket per actionable file, and people then set Status, add Notes,
 * and tick Rerun by hand. A weekly snapshot of the staging sheet can never show
 * whether anything got fixed; only this sheet knows that.
 *
 * Because humans edit it directly, parsing here is forgiving: anything
 * unexpected is surfaced rather than dropped.
 */

import type { OpenIssue, TicketOwner } from '@/types';
import { ageInDays, parseTicketCreatedDate } from './dates';

export interface TicketRow {
  row_number?: number | string;
  'Row in Staging'?: string;
  Status?: string;
  Week?: string;
  'Created Date'?: string;
  Client?: string;
  'File Name'?: string;
  'Error Type'?: string;
  Supplier?: string;
  Utility?: string;
  'Ethan: what to do'?: string;
  'Alistair: what to do'?: string;
  'Adit: what to do'?: string;
  Link?: string;
  Notes?: string;
  Rerun?: string;
  [key: string]: unknown;
}

/**
 * Statuses that mean "no longer needs attention".
 *
 * Deliberately a closed list of terminal states rather than an open list of
 * active ones: a status nobody anticipated (a typo, a new workflow stage)
 * should keep the ticket visible, not silently retire it.
 */
const CLOSED_STATUSES = new Set(['closed', 'resolved', 'done', 'complete', 'completed']);

/**
 * Checked in a fixed order so a row with two populated cells still resolves
 * deterministically. The sample data has exactly one per row, but the sheet is
 * hand-edited and that will not hold forever.
 */
const OWNER_COLUMNS: { owner: Exclude<TicketOwner, null>; column: string }[] = [
  { owner: 'Ethan', column: 'Ethan: what to do' },
  { owner: 'Alistair', column: 'Alistair: what to do' },
  { owner: 'Adit', column: 'Adit: what to do' },
];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isAffirmative(value: unknown): boolean {
  return /^y(es)?$/i.test(text(value));
}

/** Maps one Tickets_Current row to the dashboard's shape. */
export function toOpenIssue(row: TicketRow, now: Date = new Date()): OpenIssue {
  const status = text(row.Status);
  const createdAt = parseTicketCreatedDate(row['Created Date']);

  let owner: TicketOwner = null;
  let nextStep = '';
  for (const candidate of OWNER_COLUMNS) {
    const instruction = text(row[candidate.column]);
    if (instruction) {
      owner = candidate.owner;
      nextStep = instruction;
      break;
    }
  }

  return {
    rowInStaging: Number(text(row['Row in Staging'])) || 0,
    status,
    // Blank counts as open: an unlabelled ticket is far more likely to be
    // untriaged than finished.
    isOpen: !CLOSED_STATUSES.has(status.toLowerCase()),
    createdAt: createdAt ? createdAt.toISOString() : null,
    ageDays: createdAt ? ageInDays(createdAt, now) : 0,
    client: text(row.Client),
    fileName: text(row['File Name']),
    errorType: text(row['Error Type']) || 'Unspecified',
    supplier: text(row.Supplier),
    utility: text(row.Utility),
    owner,
    nextStep,
    link: text(row.Link),
    notes: text(row.Notes),
    rerunRequested: isAffirmative(row.Rerun),
  };
}
