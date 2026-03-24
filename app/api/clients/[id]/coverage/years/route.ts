export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

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
    const supabase = createSupabaseServerClient();
    const clientId = params.id;

    const { data: facilities, error: facilitiesError } = await supabase
      .from('facilities')
      .select('id')
      .eq('client_id', clientId);

    if (facilitiesError) throw facilitiesError;

    const facilityIds = (facilities || []).map((f: any) => f.id);

    if (facilityIds.length === 0) {
      const now = new Date();
      const currentFY = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
      return NextResponse.json({ fiscalYears: [currentFY - 2, currentFY - 1, currentFY, currentFY + 1] });
    }

    // Get meters for these facilities
    const { data: meters, error: metersError } = await supabase
      .from('meters')
      .select('id')
      .in('facility_id', facilityIds);

    if (metersError) throw metersError;

    const meterIds = (meters || []).map((m: any) => m.id);

    // Gather date extremes from actual_invoices (metered)
    let meteredEarliest: string | null = null;
    let meteredLatest: string | null = null;

    if (meterIds.length > 0) {
      const [earliestRes, latestRes] = await Promise.all([
        supabase
          .from('actual_invoices')
          .select('period_start_date')
          .in('meter_id', meterIds)
          .order('period_start_date', { ascending: true })
          .limit(1),
        supabase
          .from('actual_invoices')
          .select('period_end_date')
          .in('meter_id', meterIds)
          .order('period_end_date', { ascending: false })
          .limit(1),
      ]);

      meteredEarliest = earliestRes.data?.[0]?.period_start_date ?? null;
      meteredLatest = latestRes.data?.[0]?.period_end_date ?? null;
    }

    // Gather date extremes from non_metered_records
    let nmEarliest: string | null = null;
    let nmLatest: string | null = null;

    const [nmEarliestRes, nmLatestRes] = await Promise.all([
      supabase
        .from('non_metered_records')
        .select('period_start_date')
        .in('facility_id', facilityIds)
        .order('period_start_date', { ascending: true })
        .limit(1),
      supabase
        .from('non_metered_records')
        .select('period_end_date')
        .in('facility_id', facilityIds)
        .order('period_end_date', { ascending: false })
        .limit(1),
    ]);

    nmEarliest = nmEarliestRes.data?.[0]?.period_start_date ?? null;
    nmLatest = nmLatestRes.data?.[0]?.period_end_date ?? null;

    // Pick the overall earliest and latest across both sources
    const allEarliest = [meteredEarliest, nmEarliest].filter(Boolean) as string[];
    const allLatest = [meteredLatest, nmLatest].filter(Boolean) as string[];

    const earliest = allEarliest.length ? allEarliest.sort()[0] : null;
    const latest = allLatest.length ? allLatest.sort().reverse()[0] : null;

    const now = new Date();
    const currentFY = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();

    const earliestFY = fiscalYearOf(earliest);
    const latestFY = fiscalYearOf(latest);

    const minFY = Math.min(earliestFY ?? currentFY, currentFY - 1);
    const maxFY = Math.max(latestFY ?? currentFY, currentFY);

    const fiscalYears: number[] = [];
    for (let fy = minFY; fy <= maxFY; fy++) fiscalYears.push(fy);

    return NextResponse.json({ fiscalYears });
  } catch (error) {
    console.error('Error fetching fiscal years:', error);
    return NextResponse.json({ fiscalYears: [] }, { status: 500 });
  }
}
