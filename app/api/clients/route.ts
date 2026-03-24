export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { calculateMonthlyCoverage } from '@/lib/coverage';
import { format } from 'date-fns';

// GET /api/clients - List all clients with facility count and coverage
export async function GET() {
  try {
    const supabase = createSupabaseServerClient();
    const now = new Date();
    const currentFY = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
    const todayStr = format(now, 'yyyy-MM-dd');
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const prevMonthEndStr = format(prevMonthEnd, 'yyyy-MM-dd');

    // Fetch all clients with facilities
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, name, facilities(id)')
      .order('name');

    if (clientsError) throw clientsError;

    // Build result with coverage calculated per client
    const clientsWithCounts = await Promise.all((clients || []).map(async (client) => {
      const facilityIds = (client.facilities || []).map((f: any) => f.id);
      let coveragePercentage: number | null = null;

      if (facilityIds.length > 0) {
        try {
          // Fetch meters for this client's facilities
          const { data: meters } = await supabase
            .from('meters')
            .select('id, in_service_start_date, in_service_end_date')
            .in('facility_id', facilityIds);

          if (meters && meters.length > 0) {
            // Filter active meters
            const activeMeters = meters.filter(m => {
              const isInactive =
                (m.in_service_end_date && m.in_service_end_date <= todayStr) ||
                (m.in_service_start_date && m.in_service_start_date > todayStr);
              return !isInactive;
            });

            if (activeMeters.length > 0) {
              const meterIds = activeMeters.map(m => m.id);
              
              // Fetch invoices for active meters
              const { data: invoices } = await supabase
                .from('actual_invoices')
                .select('meter_id, period_start_date, period_end_date')
                .in('meter_id', meterIds);

              // Group invoices by meter
              const invoicesByMeter: Record<string, any[]> = {};
              for (const inv of invoices || []) {
                if (!invoicesByMeter[inv.meter_id]) invoicesByMeter[inv.meter_id] = [];
                invoicesByMeter[inv.meter_id].push(inv);
              }

              // Calculate coverage
              let totalDaysCovered = 0;
              let totalPossibleDays = 0;

              for (const meter of activeMeters) {
                const coverage = calculateMonthlyCoverage(invoicesByMeter[meter.id] || [], currentFY);

                for (const mc of coverage) {
                  const monthDate = mc.monthDate instanceof Date ? mc.monthDate : new Date(mc.monthDate);
                  const monthStartStr = format(monthDate, 'yyyy-MM-dd');
                  const monthEndDate = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
                  const monthEndStr = format(monthEndDate, 'yyyy-MM-dd');

                  // Only count completed past months
                  if (monthEndStr > prevMonthEndStr) continue;

                  const beforeServiceStart = meter.in_service_start_date && monthEndStr < meter.in_service_start_date;
                  const afterServiceEnd = meter.in_service_end_date && monthStartStr >= meter.in_service_end_date;
                  if (beforeServiceStart || afterServiceEnd) continue;

                  let activeDaysInMonth = mc.daysInMonth;
                  if (meter.in_service_start_date && meter.in_service_start_date > monthStartStr && meter.in_service_start_date <= monthEndStr) {
                    activeDaysInMonth -= new Date(meter.in_service_start_date).getDate() - 1;
                  }
                  if (meter.in_service_end_date && meter.in_service_end_date > monthStartStr && meter.in_service_end_date <= monthEndStr) {
                    const endDay = new Date(meter.in_service_end_date).getDate();
                    activeDaysInMonth -= monthEndDate.getDate() - endDay + 1;
                  }

                  totalDaysCovered += Math.min(mc.daysCovered, activeDaysInMonth);
                  totalPossibleDays += activeDaysInMonth;
                }
              }

              if (totalPossibleDays > 0) {
                coveragePercentage = Math.round((totalDaysCovered / totalPossibleDays) * 1000) / 10;
              }
            }
          }
        } catch (coverageError) {
          console.error(`Error calculating coverage for client ${client.id}:`, coverageError);
        }
      }

      return {
        client: {
          id: client.id,
          name: client.name
        },
        facilitiesCount: (client.facilities || []).length,
        coveragePercentage
      };
    }));

    return NextResponse.json({ data: clientsWithCounts });
  } catch (error) {
    console.error('Error fetching clients:', error);
    return NextResponse.json(
      { data: [], error: 'Failed to fetch clients' },
      { status: 500 }
    );
  }
}

// POST /api/clients - Create new client
export async function POST(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();
    const { name } = body;
    
    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'Client name is required' },
        { status: 400 }
      );
    }
    
    const { data, error } = await supabase
      .from('clients')
      .insert([{ name: name.trim() }])
      .select()
      .single();
    
    if (error) throw error;
    
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('Error creating client:', error);
    return NextResponse.json(
      { data: [], error: 'Failed to create client' },
      { status: 500 }
    );
  }
}