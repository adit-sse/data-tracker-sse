// Database types matching Supabase schema

export interface Client {
  id: string;
  name: string;
  logo_url?: string;
  created_at?: string;
}

export interface Facility {
  id: string;
  client_id: string;
  name: string;
  address?: string;
  created_at?: string;
}

/** NGERS grouping — Scope 1, 2, or 3 (e.g. "Stationary Energy", "Transport", "Electricity") */
export interface Category {
  id: string;
  name: string;
  scope: 1 | 2 | 3;
  created_at?: string;
}

/** Specific energy/fuel input (renamed from UtilityCategory) */
export interface InputType {
  id: string;
  name: string;
  scope?: number;        // 1, 2, or 3
  is_metered?: boolean;
  needs_review?: boolean;
}

/** @deprecated Use InputType instead */
export type UtilityCategory = InputType;

export interface Supplier {
  id: string;
  name: string;
  created_at?: string;
}

export type IdentifierType =
  | 'NMI'
  | 'MIRN'
  | 'ACCOUNT_NUMBER'
  | 'METER_NUMBER'
  | 'REGISTRATION_PLATE'
  | 'CARD_NUMBER'
  | 'FACILITY_LEVEL'
  | 'DESCRIPTION';

/**
 * Every identifier_type the DB accepts, with its display label.
 *
 * Mirrors the CHECK constraint on meters.identifier_type (see
 * supabase-migration-mirn.sql). Selectable lists must render all of these —
 * omitting one means a meter using it silently changes type when edited.
 */
export const IDENTIFIER_TYPES: ReadonlyArray<{ value: IdentifierType; label: string }> = [
  { value: 'NMI', label: 'NMI' },
  { value: 'MIRN', label: 'MIRN' },
  { value: 'ACCOUNT_NUMBER', label: 'Account Number' },
  { value: 'METER_NUMBER', label: 'Meter Number' },
  { value: 'REGISTRATION_PLATE', label: 'Rego Plate' },
  { value: 'CARD_NUMBER', label: 'Card Number' },
  { value: 'FACILITY_LEVEL', label: 'Facility Level' },
  { value: 'DESCRIPTION', label: 'Description' },
];

/** Display label for an identifier_type, falling back to the raw value. */
export function formatIdentifierType(type: string): string {
  return IDENTIFIER_TYPES.find((t) => t.value === type)?.label ?? type;
}

export interface Meter {
  id: string;
  facility_id: string;
  supplier_id?: string | null;
  input_type_id: string;
  category_id?: string | null;
  identifier_type: IdentifierType;
  lookup1: string;  // Primary identifier
  lookup2?: string; // Secondary identifier (e.g., "WA - SWIS", "LPG")
  in_service_start_date?: string;
  in_service_end_date?: string;
  needs_attention?: boolean;
  is_active?: boolean;
  created_at?: string;
  // Joined data
  facility?: Facility;
  supplier?: Supplier;
  input_type?: InputType;
  category?: Category | null;
  /** @deprecated Use input_type */
  utility_category?: InputType;
}

export interface ActualInvoice {
  id: string;
  meter_id: string;
  period_start_date: string;  // ISO date string
  period_end_date: string;    // ISO date string
  status?: string;
  created_at?: string;
  confirmed_at?: string;
  // Joined data
  meter?: Meter;
}

// UI types
export interface MonthlyCoverage {
  month: string;
  monthDate: Date;
  daysInMonth: number;
  daysCovered: number;
  percentage: number;
  gaps?: DateGap[];
  /** Days in this month marked deactivated (no API data expected); excluded from coverage denominator. */
  daysDeactivated?: number;
  /** Entire month is deactivated-only (no invoice data). */
  isDeactivatedMonth?: boolean;
  /** Days we measure coverage against (daysInMonth minus deactivated-only days). */
  effectiveDaysInMonth?: number;
  /** At least one invoice in this month has PENDING status (invoice expected but not yet confirmed). */
  hasPending?: boolean;
  // Invoices that overlap this month (optional)
  invoices?: ActualInvoice[];
}

export interface DateGap {
  start: string;
  end: string;
  days: number;
}

export interface ClientWithStats {
  client: Client;
  facilitiesCount: number;
  currentMonthCoverage: {
    month: string;
    daysCovered: number;
    totalPossibleDays: number;
    percentage: number;
  };
}

export interface MeterWithCoverage {
  meter: Meter;
  coverage: MonthlyCoverage[];
}

// CSV Upload types - Original invoice format
export interface CSVRow {
  ID?: string;
  Framework?: string;
  Version?: string;
  Company?: string;
  Facility?: string;
  Category?: string;
  'Input Type'?: string;
  Consumption?: string;
  'Unit Type'?: string;
  'Sub-category'?: string;
  Provider?: string;
  'Supply Address'?: string;
  'Account Number'?: string;
  'Meter Number'?: string;
  'Invoice Number'?: string;
  NMI?: string;
  MIRN?: string;
  'Amount($)'?: string;
  'Consumption Date'?: string;
  'Invoice Date'?: string;
  'Date Range'?: string;
  Customer?: string;
  'Output (tCO2-e)'?: string;
  'Evidence Link'?: string;
  'File ID'?: string;
}

// CSV Upload types - Simplified meter setup format
export interface MeterSetupRow {
  Facility?: string;
  /** NGERS / reporting group (Scope 1, 2, or 3). */
  Category?: string;
  /** Specific input type name — must exist in Manage Input Types */
  'Input Type'?: string;
  /** @deprecated Prefer Input Type + Category. Maps legacy templates to input types. */
  Utility?: string;
  Supplier?: string;
  Address?: string;
  MonthsWithData?: string;
  DataPointCount?: string;
  /** Months with no live/API data (account deactivated), same date format as MonthsWithData */
  MonthsDeactivated?: string;
  DeactivatedCount?: string;
  Identifier?: string; // optional meter identifier (NMI, account number, etc.)
}

export interface UploadResult {
  success: boolean;
  imported: number;
  /** Number of meters/utility lines registered without invoice data (setup-only rows). */
  metersSetup?: number;
  errors: string[];
  warnings?: string[];
}

// -------------------------------------------------------
// Facility Groups (non-metered Scope 1 inference)
// -------------------------------------------------------

export interface FacilityGroup {
  id: string;
  client_id: string;
  supplier_id: string;
  category_id: string | null;
  name: string;
  supplier?: Supplier;
  category?: Category;
  members?: FacilityGroupMember[];
}

export interface FacilityGroupMember {
  id: string;
  group_id: string;
  non_metered_line_id: string;
  /** Joined via non_metered_lines */
  line?: {
    id: string;
    facility_id: string;
    input_type_id: string;
    supplier_id?: string;
    facility?: Facility;
    input_type?: InputType;
    supplier?: Supplier;
  };
}

// -------------------------------------------------------
// Non-metered lines (registration — the meters-table equivalent for non-metered)
// -------------------------------------------------------

export interface NonMeteredLine {
  id: string;
  facility_id: string;
  supplier_id: string;
  input_type_id: string;
  category_id?: string | null;
  is_active: boolean;
  created_at?: string;
  // Joined
  facility?: Facility;
  supplier?: Supplier;
  input_type?: InputType;
  category?: Category | null;
}

// -------------------------------------------------------
// Non-metered records (Scope 1 non-metered, Scope 3)
// -------------------------------------------------------

export type NonMeteredStatus =
  | 'IMPORTED'
  | 'INFERRED_EMPTY'
  | 'MANUAL'
  | 'PENDING'
  | 'ERROR'
  | 'CONFIRMED'
  | 'DEACTIVATED';

export interface NonMeteredRecord {
  id: string;
  facility_id: string;
  supplier_id: string | null;
  input_type_id: string;
  period_start_date: string;
  period_end_date: string;
  status: NonMeteredStatus;
  inferred_from_id?: string | null;
  created_at?: string;
  confirmed_at?: string;
  // Joined
  facility?: Facility;
  supplier?: Supplier;
  input_type_obj?: InputType;
}

// UI types for non-metered coverage grid

export interface NonMeteredMonthlyCoverage {
  month: string;         // e.g. "Jul 25"
  monthDate: Date;
  status: NonMeteredStatus | null;
  record?: NonMeteredRecord;
}

export interface NonMeteredRowWithCoverage {
  lineId: string;
  facilityId: string;
  facilityName: string;
  supplierId: string | null;
  supplierName: string;
  /** ID of the input_type (formerly utility_category) */
  inputTypeId: string;
  inputTypeName: string;
  /** ID of the NGERS category (Scope 1/3 only) */
  categoryId?: string | null;
  categoryName?: string | null;
  groupId?: string;
  groupName?: string;
  isActive: boolean;
  coverage: NonMeteredMonthlyCoverage[];
}

// -------------------------------------------------------
// Ingestion events (audit log of confirm/error attempts)
// -------------------------------------------------------

export type IngestionEventOutcome = 'SUCCESS' | 'FAILURE';

export interface IngestionEvent {
  id: number;
  created_at: string;
  endpoint: string;
  outcome: IngestionEventOutcome;
  scope_kind: string | null;
  group_id?: number | null;
  client_id: number | null;
  client_name: string | null;
  supplier_name: string | null;
  facility_name: string | null;
  utility_name: string | null;
  period_start: string | null;
  reason: string | null;
  http_status: number | null;
  affected_count: number | null;
  payload_excerpt?: unknown;
  duration_ms: number | null;
  // Joined
  client?: { id: number; name: string } | null;
  /** Present on GET /api/activity responses */
  triage?: IngestionEventTriageEmbed;
}

export type IngestionEventTriageStatus = 'unreviewed' | 'in_progress' | 'addressed';

/** Triage fields embedded on an ingestion event (no event_id — use event.id). */
export interface IngestionEventTriageEmbed {
  status: IngestionEventTriageStatus;
  note: string | null;
  custom_tags: string[];
  updated_at?: string | null;
  updated_by?: string | null;
}

export interface IngestionEventTriage extends IngestionEventTriageEmbed {
  event_id: number;
}

// -------------------------------------------------------
// Stuck pending records (cross-client ingestion overview)
// -------------------------------------------------------

export interface StuckPendingRecord {
  id: number;
  kind: 'non-metered' | 'metered';
  client_id: number;
  client_name: string;
  facility_name: string | null;
  supplier_name: string | null;
  utility_name: string | null;
  period_start: string | null;
  created_at: string;
  age_hours: number;
  /** Set when this non-metered row belongs to a facility group. */
  group_id?: number | null;
  group_name?: string | null;
}
