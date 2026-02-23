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
}

export interface Supplier {
  id: string;
  name: string;
  created_at?: string;
}

export type IdentifierType = 
  | 'NMI' 
  | 'ACCOUNT_NUMBER' 
  | 'METER_NUMBER' 
  | 'REGISTRATION_PLATE' 
  | 'CARD_NUMBER';

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
  Provider?: string;
  'Supply Address'?: string;
  'Account Number'?: string;
  'Meter Number'?: string;
  'Invoice Number'?: string;
  NMI?: string;
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
}

export interface UploadResult {
  success: boolean;
  imported: number;
  errors: string[];
  warnings?: string[];
}
