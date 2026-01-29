import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { parseDateRange } from '@/lib/coverage';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { CSVRow, UploadResult, IdentifierType } from '@/types';

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
    let rows: CSVRow[] = [];
    
    // Handle XLSX files
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(worksheet, { raw: false }) as CSVRow[];
    } 
    // Handle CSV files
    else if (fileName.endsWith('.csv')) {
      const text = await file.text();
      const parseResult = Papa.parse<CSVRow>(text, {
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
    
    const errors: string[] = [];
    let imported = 0;
    
    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 for header row and 1-indexed
      
      try {
        await processRow(params.id, row, rowNum);
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
  // Convert client ID to integer for database operations
  const clientIdInt = parseInt(clientId);
  
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
  
  // 3. Find or create facility
  let { data: facility } = await supabase
    .from('facilities')
    .select('id')
    .eq('client_id', clientIdInt) // Use integer version
    .eq('name', row.Facility.trim())
    .single();
  
  if (!facility) {
    const { data: newFacility, error } = await supabase
      .from('facilities')
      .insert([{
        client_id: clientIdInt, // Use integer version
        name: row.Facility.trim(),
        address: row['Supply Address']?.trim() || null
      }])
      .select('id')
      .single();
    
    if (error) throw new Error(`Failed to create facility: ${error.message}`);
    facility = newFacility;
  }
  
  // 4. Find or create supplier (OPTIONAL)
  let supplierId = null;
  
  if (providerName) {
    let { data: supplier } = await supabase
      .from('suppliers')
      .select('id')
      .eq('name', providerName)
      .single();
    
    if (!supplier) {
      const { data: newSupplier, error } = await supabase
        .from('suppliers')
        .insert([{ name: providerName }])
        .select('id')
        .single();
      
      if (error) throw new Error(`Failed to create supplier: ${error.message}`);
      supplier = newSupplier;
    }
    
    supplierId = supplier.id;
  }
  
  // 5. Find utility category
  const categoryMap: Record<string, string> = {
    'ELECTRICITY': 'ELECTRICITY',
    'GAS': 'GAS',
    'FUEL': 'FUEL',
    'OIL': 'OIL'
  };
  
  const categoryName = categoryMap[row.Category.toUpperCase()];
  if (!categoryName) {
    throw new Error(`Invalid category: ${row.Category}`);
  }
  
  const { data: category } = await supabase
    .from('utility_categories')
    .select('id')
    .eq('name', categoryName)
    .single();
  
  if (!category) {
    throw new Error(`Utility category not found: ${categoryName}`);
  }
  
  // 6. Determine identifier type and lookup values
  let identifierType: IdentifierType;
  let lookup1: string;
  let lookup2: string | null = null;
  
  if (row.NMI && row.NMI.trim()) {
    identifierType = 'NMI';
    lookup1 = row.NMI.trim();
    lookup2 = row['Input Type']?.trim() || null;
  } else if (row['Account Number'] && row['Account Number'].trim()) {
    identifierType = 'ACCOUNT_NUMBER';
    lookup1 = row['Account Number'].trim();
    lookup2 = row['Input Type']?.trim() || null;
  } else if (row['Meter Number'] && row['Meter Number'].trim()) {
    identifierType = 'METER_NUMBER';
    lookup1 = row['Meter Number'].trim();
  } else {
    throw new Error('No meter identifier found (NMI, Account Number, or Meter Number)');
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
