import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function fiscalYearOf(dateString: string | null | undefined): number | null {
  if (!dateString) return null;
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return null;
  const month = d.getMonth(); // 0-indexed
  const year = d.getFullYear();
  return month >= 6 ? year + 1 : year; // July (6) starts new FY
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const clientId = parseInt(params.id);

    // Get facilities for client
    const { data: facilities, error: facilitiesError } = await supabase
      .from('facilities')
      .select('id')
      .eq('client_id', clientId);

    if (facilitiesError) throw facilitiesError;

    const facilityIds = (facilities || []).map((f: any) => f.id);

    if (facilityIds.length === 0) {
      // No facilities -> fallback to current FY range
      const now = new Date();
      const currentFY = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
      return NextResponse.json({ fiscalYears: [currentFY - 1, currentFY, currentFY + 1] });
    }

    // Get meters for these facilities
    const { data: meters, error: metersError } = await supabase
      .from('meters')
      .select('id')
      .in('facility_id', facilityIds);

    if (metersError) throw metersError;

    const meterIds = (meters || []).map((m: any) => m.id);

    if (meterIds.length === 0) {
      const now = new Date();
      const currentFY = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
      return NextResponse.json({ fiscalYears: [currentFY - 1, currentFY, currentFY + 1] });
    }

    // Get earliest period_start_date
    const { data: earliestData, error: earliestError } = await supabase
      .from('actual_invoices')
      .select('period_start_date')
      .in('meter_id', meterIds)
      .order('period_start_date', { ascending: true })
      .limit(1);

    if (earliestError) throw earliestError;

    // Get latest period_end_date
    const { data: latestData, error: latestError } = await supabase
      .from('actual_invoices')
      .select('period_end_date')
      .in('meter_id', meterIds)
      .order('period_end_date', { ascending: false })
      .limit(1);

    if (latestError) throw latestError;

    const earliest = earliestData?.[0]?.period_start_date || null;
    const latest = latestData?.[0]?.period_end_date || null;

    const earliestFY = fiscalYearOf(earliest);
    const latestFY = fiscalYearOf(latest);

    const now = new Date();
    const currentFY = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();

    const minFY = Math.min(
      earliestFY ?? currentFY,
      currentFY
    );
    const maxFY = Math.max(
      latestFY ?? currentFY,
      currentFY
    );

    // Build fiscal year array inclusive
    const fiscalYears: number[] = [];
    for (let fy = minFY; fy <= maxFY; fy++) fiscalYears.push(fy);

    return NextResponse.json({ fiscalYears });
  } catch (error) {
    console.error('Error fetching fiscal years:', error);
    return NextResponse.json({ fiscalYears: [] }, { status: 500 });
  }
}
