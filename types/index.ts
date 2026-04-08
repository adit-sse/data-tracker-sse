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

/** NGERS grouping — Scope 1 or Scope 3 only (e.g. "Stationary Energy", "Transport") */
export interface Category {
  id: string;
  name: string;
  scope: 1 | 3;
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
  invoice_number?: string;
  invoice_date?: string;
  period_start_date: string;  // ISO date string
  period_end_date: string;    // ISO date string
  consumption?: number;
  amount?: number;
  framework?: string;
  version?: string;
  input_type?: string;
  emissions_factor?: number;
  customer?: string;
  status?: string;
  created_at?: string;
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
  /** NGERS / reporting group (Scope 1 or 3). Optional for Scope 2 (e.g. electricity). */
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
  input_type_id: string | null;
  name: string;
  supplier?: Supplier;
  input_type?: InputType;
  members?: FacilityGroupMember[];
}

export interface FacilityGroupMember {
  id: string;
  group_id: string;
  facility_id: string;
  input_type_id?: string | null;
  facility?: Facility;
  input_type?: InputType;
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
  invoice_number?: string | null;
  invoice_date?: string | null;
  period_start_date: string;
  period_end_date: string;
  consumption?: number | null;
  unit?: string | null;
  amount?: number | null;
  /** @deprecated Legacy text field — category is now a FK on the line */
  sub_category?: string | null;
  /** @deprecated Legacy text field — use input_type_id FK instead */
  input_type?: string | null;
  framework?: string | null;
  version?: string | null;
  customer?: string | null;
  status: NonMeteredStatus;
  inferred_from_id?: string | null;
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
