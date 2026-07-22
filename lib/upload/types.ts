/**
 * lib/upload/types.ts
 *
 * Internal payload types shared between the row processors and the batch writers.
 * Separate from @/types (which holds public API shapes) to keep the upload
 * pipeline's internal contracts in one place.
 */

export interface NonMeteredPayload {
  facilityId: string;
  supplierId: string | null;
  /** input_types.id */
  categoryId: string;
  /** public.categories.id when Scope 1 / 3 */
  reportingCategoryId?: string | null;
  periodStart: string;
  periodEnd: string;
  status: string;
}

export interface PendingInvoice {
  meter_id: string;
  period_start_date: string;
  period_end_date: string;
  status: string;
}
