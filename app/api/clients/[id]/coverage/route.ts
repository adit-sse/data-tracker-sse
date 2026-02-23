export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
    const fiscalYearParam = searchParams.get('fiscalYear');
    const fiscalYear = fiscalYearParam ? parseInt(fiscalYearParam, 10) : new Date().getFullYear();
    
    const clientId = params.id;
    
    // Get all facilities for this client
    const { data: facilities, error: facilitiesError } = await supabase
      .from('facilities')
      .select('id')
      .eq('client_id', clientId);
    
    if (facilitiesError) throw facilitiesError;
    
    const facilityIds = facilities?.map(f => f.id) || [];
    
    if (facilityIds.length === 0) {
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
    
    if (metersError) throw metersError;
    
    // Get all invoices for these meters
    const meterIds = meters?.map(m => m.id) || [];
    
    let invoices: any[] = [];
    
    if (meterIds.length > 0) {
      const { data: invoicesData, error: invoicesError } = await supabase
        .from('actual_invoices')
        .select('*')
        .in('meter_id', meterIds);
      
      if (invoicesError) throw invoicesError;
      
      invoices = invoicesData || [];
    }
    
    // Group invoices by meter
    const invoicesByMeter = (invoices || []).reduce((acc, invoice) => {
      if (!acc[invoice.meter_id]) {
        acc[invoice.meter_id] = [];
      }
      acc[invoice.meter_id].push(invoice);
      return acc;
    }, {} as Record<string, any[]>);
    
    // Calculate coverage for each meter
    const metersWithCoverage = (meters || []).map(meter => ({
      meter,
      coverage: calculateMonthlyCoverage(
        invoicesByMeter[meter.id] || [],
        fiscalYear
      )
    }));
    
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
