export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { calculateMonthlyCoverage } from '@/lib/coverage';
import { fetchSlotsByMeter } from '@/lib/meter-month-slots';
import { generateFiscalYearMonths } from '@/lib/coverage';
import { format, startOfMonth, endOfMonth } from 'date-fns';

// GET /api/clients/[id]/coverage - Get full coverage data for fiscal year
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const { searchParams } = new URL(request.url);
    const fiscalYearParam = searchParams.get('fiscalYear');
    
    // Calculate current fiscal year (July starts new FY)
    const now = new Date();
    const currentFY = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
    const fiscalYear = fiscalYearParam ? parseInt(fiscalYearParam, 10) : currentFY;
    
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
        input_type:input_types(*),
        category:categories(*)
      `)
      .in('facility_id', facilityIds)
      .order('facility_id');
    
    if (metersError) throw metersError;
    
    // Get all invoices for these meters
    const meterIds = meters?.map(m => m.id) || [];
    
    let invoices: any[] = [];

    // Compute the month window for this fiscal year (for slot scoping).
    const fyMonths = generateFiscalYearMonths(fiscalYear);
    const fyStart = format(startOfMonth(fyMonths[0]), 'yyyy-MM-dd');
    const fyEnd = format(startOfMonth(fyMonths[fyMonths.length - 1]), 'yyyy-MM-dd');

    let slotsByMeter = new Map<string, any[]>();

    if (meterIds.length > 0) {
      // Fetch invoices and slots in parallel.
      const chunkSize = 200;
      const chunks: (typeof meterIds)[] = [];
      for (let i = 0; i < meterIds.length; i += chunkSize) {
        chunks.push(meterIds.slice(i, i + chunkSize));
      }
      const [chunkResults, fetchedSlots] = await Promise.all([
        Promise.all(
          chunks.map((chunk) =>
            supabase
              .from('actual_invoices')
              .select('id, meter_id, period_start_date, period_end_date, status, confirmed_at')
              .in('meter_id', chunk)
              .limit(10000)
          )
        ),
        fetchSlotsByMeter(supabase, meterIds, fyStart, fyEnd).catch((e) => {
          console.error('[coverage] slot fetch failed, degrading gracefully:', e?.message);
          return new Map<string, any[]>();
        }),
      ]);
      for (const { data: invoicesData, error: invoicesError } of chunkResults) {
        if (invoicesError) throw invoicesError;
        invoices.push(...(invoicesData || []));
      }
      slotsByMeter = fetchedSlots;
    }

    // Group invoices by meter
    const invoicesByMeter = (invoices || []).reduce((acc, invoice) => {
      if (!acc[invoice.meter_id]) {
        acc[invoice.meter_id] = [];
      }
      acc[invoice.meter_id].push(invoice);
      return acc;
    }, {} as Record<string, any[]>);

    // Calculate coverage for each meter, passing slots so hasPending/isDeactivated
    // are derived from slot status rather than from placeholder rows in actual_invoices.
    const metersWithCoverage = (meters || []).map(meter => ({
      meter,
      coverage: calculateMonthlyCoverage(
        invoicesByMeter[meter.id] || [],
        fiscalYear,
        slotsByMeter.get(meter.id) ?? []
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
