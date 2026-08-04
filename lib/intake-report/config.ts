/**
 * Which sheets back the intake dashboard.
 *
 * Defaults point at the live sheets the n8n workflows already use, so the
 * feature works with only the two credential vars set. The IDs are overridable
 * for anyone pointing a dev environment at a copy.
 */

/** p1EmailStaging — every file that entered the pipeline. */
export const STAGING_SHEET_ID =
  process.env.INTAKE_STAGING_SHEET_ID?.trim() ||
  '1z1gVtfZwAIZVzbgp0HQv2pvqg62ca3FdDTb4upY0_9w';

export const STAGING_TAB = process.env.INTAKE_STAGING_TAB?.trim() || 'Sheet1';

/** ticket_tracker_template — errors currently being worked on. */
export const TICKETS_SHEET_ID =
  process.env.INTAKE_TICKETS_SHEET_ID?.trim() ||
  '11C6Ev6_swjGRKpiNdnU1_qWsPV3OnHgch83FzOGg4QU';

export const TICKETS_TAB = process.env.INTAKE_TICKETS_TAB?.trim() || 'Tickets_Current';
