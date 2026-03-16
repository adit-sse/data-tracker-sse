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

export interface UtilityCategory {
  id: string;
  name: string;
  scope?: number;        // 1, 2, or 3
  is_metered?: boolean;
  needs_review?: boolean;
}

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
  | 'DESCRIPTION';

export interface Meter {
  id: string;
  facility_id: string;
  supplier_id?: string | null;  // Optional - meters can exist without a supplier
  utility_category_id: string;
  identifier_type: IdentifierType;
  lookup1: string;  // Primary identifier
  lookup2?: string; // Secondary identifier (e.g., "WA - SWIS", "LPG")
  in_service_start_date?: string; // Date when meter came into service (null = always in service)
  in_service_end_date?: string;   // Date when meter went out of service (null = still in service)
  needs_attention?: boolean;      // User-flagged: meter needs attention
  created_at?: string;
  // Joined data
  facility?: Facility;
  supplier?: Supplier;
  utility_category?: UtilityCategory;
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
  Utility?: string;
  Supplier?: string;
  Address?: string;
  MonthsWithData?: string;
  DataPointCount?: string;
  Identifier?: string; // optional meter identifier (NMI, account number, etc.)
}

export interface UploadResult {
  success: boolean;
  imported: number;
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
  utility_category_id: string | null;
  name: string;
  supplier?: Supplier;
  utility_category?: UtilityCategory;
  members?: FacilityGroupMember[];
}

export interface FacilityGroupMember {
  id: string;
  group_id: string;
  facility_id: string;
  facility?: Facility;
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
  | 'CONFIRMED';

export interface NonMeteredRecord {
  id: string;
  facility_id: string;
  supplier_id: string | null;
  utility_category_id: string;
  invoice_number?: string | null;
  invoice_date?: string | null;
  period_start_date: string;
  period_end_date: string;
  consumption?: number | null;
  unit?: string | null;
  amount?: number | null;
  sub_category?: string | null;
  input_type?: string | null;
  framework?: string | null;
  version?: string | null;
  customer?: string | null;
  status: NonMeteredStatus;
  inferred_from_id?: string | null;
  // Joined
  facility?: Facility;
  supplier?: Supplier;
  utility_category?: UtilityCategory;
}

// UI types for non-metered coverage grid

export interface NonMeteredMonthlyCoverage {
  month: string;         // e.g. "Jul 25"
  monthDate: Date;
  status: NonMeteredStatus | null;
  record?: NonMeteredRecord;
}

export interface NonMeteredRowWithCoverage {
  facilityId: string;
  facilityName: string;
  supplierId: string | null;
  supplierName: string;
  categoryId: string;
  categoryName: string;
  coverage: NonMeteredMonthlyCoverage[];
}
