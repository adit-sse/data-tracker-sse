export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { parseDateRange } from '@/lib/coverage';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { CSVRow, MeterSetupRow, UploadResult, IdentifierType } from '@/types';

// POST /api/clients/[id]/upload - Process CSV/XLSX upload
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file uploaded' },
        { status: 400 }
      );
    }
    
    const fileName = file.name.toLowerCase();
    let rows: Record<string, string>[] = [];
    
    // Handle XLSX files
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(worksheet, { raw: false });
    } 
    // Handle CSV files
    else if (fileName.endsWith('.csv')) {
      const text = await file.text();
      const parseResult = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim()
      });
      
      if (parseResult.errors.length > 0) {
        return NextResponse.json(
          { error: 'Failed to parse CSV file', details: parseResult.errors },
          { status: 400 }
        );
      }
      
      rows = parseResult.data;
    } else {
      return NextResponse.json(
        { error: 'Invalid file format. Please upload a CSV or XLSX file.' },
        { status: 400 }
      );
    }
    
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'File is empty or has no valid data rows' },
        { status: 400 }
      );
    }
    
    // Detect format based on column headers
    const firstRow = rows[0];
    const headers = Object.keys(firstRow);
    const isMeterSetupFormat = headers.some(h => h === 'Utility' || h === 'MonthsWithData');
    
    const errors: string[] = [];
    let imported = 0;
    
    // Process each row based on detected format
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 for header row and 1-indexed
      
      try {
        if (isMeterSetupFormat) {
          await processMeterSetupRow(params.id, row as unknown as MeterSetupRow, rowNum);
        } else {
          await processRow(params.id, row as unknown as CSVRow, rowNum);
        }
        imported++;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Row ${rowNum}: ${message}`);
      }
    }
    
    const result: UploadResult = {
      success: imported > 0,
      imported,
      errors
    };
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error processing upload:', error);
    return NextResponse.json(
      { error: 'Failed to process upload' },
      { status: 500 }
    );
  }
}

async function processRow(clientId: string, row: CSVRow, rowNum: number): Promise<void> {
  
  // 1. Validate required fields - CHECK EACH ONE INDIVIDUALLY
  const missingFields: string[] = [];
  
  if (!row.Company?.trim()) missingFields.push('Company');
  if (!row.Facility?.trim()) missingFields.push('Facility');
  if (!row.Category?.trim()) missingFields.push('Category');
  
  if (missingFields.length > 0) {
    throw new Error(`Missing required field(s): ${missingFields.join(', ')}`);
  }
  
  if (!row['Date Range']) {
    throw new Error('Missing Date Range');
  }
  
  // Provider is optional
  const providerName = row.Provider?.trim() || null;
  
  // 2. Parse date range
  const dateRange = parseDateRange(row['Date Range']);
  if (!dateRange) {
    throw new Error(`Invalid date range format: ${row['Date Range']}`);
  }
  
  // 3. Find or create facility (case-insensitive lookup)
  const facilityName = row.Facility.trim();
  const { data: facilityRows } = await supabase
    .from('facilities')
    .select('id')
    .eq('client_id', clientId)
    .ilike('name', facilityName)
    .limit(1);

  let facility: { id: string } | null = facilityRows?.[0] || null;

  if (!facility) {
    const { data: newFacility, error } = await supabase
      .from('facilities')
      .insert([{ client_id: clientId, name: facilityName, address: row['Supply Address']?.trim() || null }])
      .select('id')
      .single();
    if (error) throw new Error(`Failed to create facility: ${error.message}`);
    facility = newFacility;
  }

  // 4. Find or create supplier (OPTIONAL)
  const supplierId = providerName ? await findOrCreateSupplier(providerName) : null;

  // 5. Find or create utility category
  const categoryName = mapUtilityToCategory(row.Category);
  const categoryId = await findOrCreateCategory(categoryName);
  const category = { id: categoryId };
  
  // 6. Determine identifier type and lookup values
  let identifierType: IdentifierType;
  let lookup1: string;
  let lookup2: string | null = null;
  
  if (row.NMI && row.NMI.trim()) {
    identifierType = 'NMI';
    lookup1 = row.NMI.trim();
    lookup2 = row['Input Type']?.trim() || null;
  } else if (row.MIRN && row.MIRN.trim()) {
    identifierType = 'MIRN';
    lookup1 = row.MIRN.trim();
    lookup2 = row['Input Type']?.trim() || null;
  } else if (row['Account Number'] && row['Account Number'].trim()) {
    identifierType = 'ACCOUNT_NUMBER';
    lookup1 = row['Account Number'].trim();
    lookup2 = row['Input Type']?.trim() || null;
  } else if (row['Meter Number'] && row['Meter Number'].trim()) {
    identifierType = 'METER_NUMBER';
    lookup1 = row['Meter Number'].trim();
  } else {
    throw new Error('No meter identifier found (NMI, MIRN, Account Number, or Meter Number)');
  }
  
  // 7. Find or create meter
  let { data: meter } = await supabase
    .from('meters')
    .select('id')
    .eq('facility_id', facility.id)
    .eq('utility_category_id', category.id)
    .eq('identifier_type', identifierType)
    .eq('lookup1', lookup1)
    .single();
  
  if (!meter) {
    const { data: newMeter, error } = await supabase
      .from('meters')
      .insert([{
        facility_id: facility.id,
        supplier_id: supplierId,  // Can be null if no provider specified
        utility_category_id: category.id,
        identifier_type: identifierType,
        lookup1: lookup1,
        lookup2: lookup2
      }])
      .select('id')
      .single();
    
    if (error) throw new Error(`Failed to create meter: ${error.message}`);
    meter = newMeter;
  }
  
  // 8. Insert invoice (check for duplicates by invoice_number if provided)
  if (row['Invoice Number'] && row['Invoice Number'].trim()) {
    const { data: existingInvoice } = await supabase
      .from('actual_invoices')
      .select('id')
      .eq('meter_id', meter.id)
      .eq('invoice_number', row['Invoice Number'].trim())
      .single();
    
    if (existingInvoice) {
      // Skip duplicate
      return;
    }
  }
  
  const { error: invoiceError } = await supabase
    .from('actual_invoices')
    .insert([{
      meter_id: meter.id,
      invoice_number: row['Invoice Number']?.trim() || null,
      invoice_date: row['Invoice Date'] || null,
      period_start_date: dateRange.startDate,
      period_end_date: dateRange.endDate,
      consumption: row.Consumption ? parseFloat(row.Consumption) : null,
      amount: row['Amount($)'] ? parseFloat(row['Amount($)'].replace(/[^0-9.-]/g, '')) : null,
      framework: row.Framework?.trim() || null,
      version: row.Version?.trim() || null,
      input_type: row['Input Type']?.trim() || null,
      emissions_factor: row['Output (tCO2-e)'] ? parseFloat(row['Output (tCO2-e)']) : null,
      customer: row.Customer?.trim() || null,
      status: 'IMPORTED'
    }]);
  
  if (invoiceError) {
    throw new Error(`Failed to create invoice: ${invoiceError.message}`);
  }
}

// Parse month range like "Jul 2025 - Nov 2025" or "Jul 2025 - Jun 2026"
function parseMonthRange(monthsWithData: string): { startDate: string; endDate: string } | null {
  if (!monthsWithData || !monthsWithData.trim()) return null;
  
  const parts = monthsWithData.split('-').map(p => p.trim());
  if (parts.length !== 2) return null;
  
  const monthMap: Record<string, number> = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
  };
  
  const parseMonthYear = (str: string): { month: number; year: number } | null => {
    const match = str.match(/^(\w{3})\s+(\d{4})$/);
    if (!match) return null;
    const month = monthMap[match[1]];
    if (month === undefined) return null;
    return { month, year: parseInt(match[2]) };
  };
  
  const start = parseMonthYear(parts[0]);
  const end = parseMonthYear(parts[1]);
  
  if (!start || !end) return null;
  
  // Start date is 1st of start month
  const startDate = `${start.year}-${String(start.month + 1).padStart(2, '0')}-01`;
  
  // End date is last day of end month
  const lastDay = new Date(end.year, end.month + 1, 0).getDate();
  const endDate = `${end.year}-${String(end.month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  
  return { startDate, endDate };
}

// Generate monthly periods between two dates
function generateMonthlyPeriods(startDate: string, endDate: string): Array<{ start: string; end: string }> {
  const periods: Array<{ start: string; end: string }> = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  let current = new Date(start.getFullYear(), start.getMonth(), 1);
  
  while (current <= end) {
    const monthStart = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
    const monthEnd = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    
    periods.push({ start: monthStart, end: monthEnd });
    
    // Move to next month
    current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  }
  
  return periods;
}

// Helper: Find an existing supplier by name (case-insensitive), or create a new one
async function findOrCreateSupplier(name: string): Promise<string> {
  const { data: existing } = await supabase
    .from('suppliers')
    .select('id')
    .ilike('name', name)
    .limit(1);

  if (existing && existing.length > 0) return existing[0].id;

  const { data: created, error } = await supabase
    .from('suppliers')
    .insert([{ name }])
    .select('id')
    .single();

  if (error) {
    // If insert failed due to duplicate (race), fetch again
    if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate')) {
      const { data: retry } = await supabase
        .from('suppliers')
        .select('id')
        .ilike('name', name)
        .limit(1);
      if (retry && retry.length > 0) return retry[0].id;
    }
    throw new Error(`Failed to create supplier: ${error.message}`);
  }

  return created.id;
}

// Helper: Find an existing utility category by name (case-insensitive), or create a new one
async function findOrCreateCategory(name: string): Promise<string> {
  const { data: existing } = await supabase
    .from('utility_categories')
    .select('id')
    .ilike('name', name)
    .limit(1);

  if (existing && existing.length > 0) return existing[0].id;

  const { data: created, error } = await supabase
    .from('utility_categories')
    .insert([{ name }])
    .select('id')
    .single();

  if (error) {
    // If insert failed due to duplicate (race), fetch again
    if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate')) {
      const { data: retry } = await supabase
        .from('utility_categories')
        .select('id')
        .ilike('name', name)
        .limit(1);
      if (retry && retry.length > 0) return retry[0].id;
    }
    throw new Error(`Failed to create utility category: ${error.message}`);
  }

  return created.id;
}

// Normalize utility names - only map exact matches for base categories
function mapUtilityToCategory(utility: string): string {
  const trimmed = utility.trim();
  const upper = trimmed.toUpperCase();
  
  // Only normalize case for the 4 base categories
  if (upper === 'ELECTRICITY') return 'ELECTRICITY';
  if (upper === 'GAS') return 'GAS';
  if (upper === 'FUEL') return 'FUEL';
  if (upper === 'OIL') return 'OIL';
  
  // Keep all other utilities as their own category (preserve original casing)
  return trimmed;
}

// Process meter setup format row
async function processMeterSetupRow(clientId: string, row: MeterSetupRow, rowNum: number): Promise<void> {
  // 1. Validate required fields
  if (!row.Facility?.trim()) {
    throw new Error('Missing Facility name');
  }
  if (!row.Utility?.trim()) {
    throw new Error('Missing Utility type');
  }
  
  const facilityName = row.Facility.trim();
  const utilityName = row.Utility.trim();
  const supplierName = row.Supplier?.trim() || null;
  const address = row.Address?.trim() || null;
  
  // 2. Parse month range if provided
  let dateRange: { startDate: string; endDate: string } | null = null;
  if (row.MonthsWithData?.trim()) {
    dateRange = parseMonthRange(row.MonthsWithData);
    if (!dateRange) {
      throw new Error(`Invalid MonthsWithData format: ${row.MonthsWithData}`);
    }
  }
  
  // 3. Find or create facility (case-insensitive lookup)
  const { data: facilityRows } = await supabase
    .from('facilities')
    .select('id')
    .eq('client_id', clientId)
    .ilike('name', facilityName)
    .limit(1);
  
  let facility: { id: string } | null = facilityRows?.[0] || null;
  
  if (!facility) {
    const { data: newFacility, error } = await supabase
      .from('facilities')
      .insert([{ client_id: clientId, name: facilityName, address }])
      .select('id')
      .single();
    if (error) throw new Error(`Failed to create facility: ${error.message}`);
    facility = newFacility;
  } else if (address) {
    await supabase.from('facilities').update({ address }).eq('id', facility.id).is('address', null);
  }
  
  // 4. Find or create supplier (if provided)
  const supplierId: string | null = supplierName ? await findOrCreateSupplier(supplierName) : null;

  // 5. Find or create utility category
  const categoryName = mapUtilityToCategory(utilityName);
  const categoryId = await findOrCreateCategory(categoryName);
  const category = { id: categoryId };

  // 6. Find or create meter (use DESCRIPTION with facility + utility as identifier, e.g. "Albany LPG")
  const identifierValue = `${facilityName} ${utilityName}`;
  
  let { data: meter } = await supabase
    .from('meters')
    .select('id')
    .eq('facility_id', facility.id)
    .eq('utility_category_id', category.id)
    .eq('identifier_type', 'DESCRIPTION')
    .eq('lookup1', identifierValue)
    .maybeSingle();
  
  if (!meter) {
    const { data: newMeter, error } = await supabase
      .from('meters')
      .insert([{
        facility_id: facility.id,
        supplier_id: supplierId,
        utility_category_id: category.id,
        identifier_type: 'DESCRIPTION' as IdentifierType,
        lookup1: identifierValue,
        lookup2: supplierName
      }])
      .select('id')
      .single();
    
    if (error) throw new Error(`Failed to create meter: ${error.message}`);
    meter = newMeter;
  }
  
  // 7. Create monthly invoices if date range is provided
  if (dateRange) {
    const periods = generateMonthlyPeriods(dateRange.startDate, dateRange.endDate);
    
    for (const period of periods) {
      // Check if invoice already exists for this period
      const { data: existingInvoice } = await supabase
        .from('actual_invoices')
        .select('id')
        .eq('meter_id', meter.id)
        .eq('period_start_date', period.start)
        .eq('period_end_date', period.end)
        .single();
      
      if (!existingInvoice) {
        const { error: invoiceError } = await supabase
          .from('actual_invoices')
          .insert([{
            meter_id: meter.id,
            period_start_date: period.start,
            period_end_date: period.end,
            status: 'IMPORTED'
          }]);
        
        if (invoiceError) {
          console.error(`Failed to create invoice for period ${period.start} - ${period.end}:`, invoiceError);
        }
      }
    }
  }
}
