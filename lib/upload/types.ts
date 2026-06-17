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
  invoiceNumber: string | null;
  invoiceDate: string | null;
  periodStart: string;
  periodEnd: string;
  consumption: number | null;
  unit: string | null;
  amount: number | null;
  subCategory: string | null;
  inputType: string | null;
  framework: string | null;
  version: string | null;
  customer: string | null;
  status: string;
}

export interface PendingInvoice {
  meter_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  period_start_date: string;
  period_end_date: string;
  consumption: number | null;
  amount: number | null;
  framework: string | null;
  version: string | null;
  input_type: string | null;
  emissions_factor: number | null;
  customer: string | null;
  status: string;
}
