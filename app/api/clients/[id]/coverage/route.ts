import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { calculateMonthlyCoverage } from '@/lib/coverage';

// GET /api/clients/[id]/coverage - Get full coverage data for fiscal year
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const fiscalYear = parseInt(searchParams.get('fiscalYear') || '2025');
    
    // IMPORTANT: Convert string ID to integer for database comparison
    const clientId = parseInt(params.id);
    
    console.log('=== COVERAGE API DEBUG ===');
    console.log('Client ID (original):', params.id, 'type:', typeof params.id);
    console.log('Client ID (converted):', clientId, 'type:', typeof clientId);
    console.log('Fiscal Year:', fiscalYear);
    
    // Get all facilities for this client
    const { data: facilities, error: facilitiesError } = await supabase
      .from('facilities')
      .select('id')
      .eq('client_id', clientId);  // Use the integer version
    
    if (facilitiesError) {
      console.error('Error fetching facilities:', facilitiesError);
      throw facilitiesError;
    }
    
    console.log('Facilities found:', facilities?.length, facilities);
    
    const facilityIds = facilities?.map(f => f.id) || [];
    
    if (facilityIds.length === 0) {
      console.log('No facilities - returning empty');
      return NextResponse.json({
        meters: [],
        fiscalYear
      });
    }
    
    // Get all meters with related data
    const { data: meters, error: metersError } = await supabase
      .from('meters')
      .select(`
        *,
        facility:facilities(*),
        supplier:suppliers(*),
        utility_category:utility_categories(*)
      `)
      .in('facility_id', facilityIds)
      .order('facility_id');
    
    if (metersError) {
      console.error('Error fetching meters:', metersError);
      throw metersError;
    }
    
    console.log('Meters found:', meters?.length, meters);
    
    // Get all invoices for these meters
    const meterIds = meters?.map(m => m.id) || [];
    
    console.log('Meter IDs:', meterIds);
    
    let invoices: any[] = [];
    
    if (meterIds.length > 0) {
      const { data: invoicesData, error: invoicesError } = await supabase
        .from('actual_invoices')
        .select('*')
        .in('meter_id', meterIds);
      
      if (invoicesError) {
        console.error('Error fetching invoices:', invoicesError);
        throw invoicesError;
      }
      
      invoices = invoicesData || [];
    }
    
    console.log('Invoices found:', invoices.length, invoices);
    
    // Group invoices by meter
    const invoicesByMeter = (invoices || []).reduce((acc, invoice) => {
      if (!acc[invoice.meter_id]) {
        acc[invoice.meter_id] = [];
      }
      acc[invoice.meter_id].push(invoice);
      return acc;
    }, {} as Record<string, any[]>);
    
    console.log('Invoices by meter:', Object.keys(invoicesByMeter).length, 'meters have invoices');
    
    // Calculate coverage for each meter
    const metersWithCoverage = (meters || []).map(meter => {
      const meterInvoices = invoicesByMeter[meter.id] || [];
      console.log(`Meter ${meter.id}: ${meterInvoices.length} invoices`);
      
      return {
        meter,
        coverage: calculateMonthlyCoverage(
          meterInvoices,
          fiscalYear
        )
      };
    });
    
    console.log('=== COVERAGE API COMPLETE ===');
    console.log('Returning', metersWithCoverage.length, 'meters with coverage');
    
    return NextResponse.json({
      meters: metersWithCoverage,
      fiscalYear
    });
  } catch (error) {
    console.error('Error fetching coverage data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch coverage data' },
      { status: 500 }
    );
  }
}
