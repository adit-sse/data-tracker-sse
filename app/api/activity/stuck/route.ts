export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { StuckPendingRecord } from '@/types';

type Joined<T> = T | T[] | null | undefined;

function joinedOne<T>(value: Joined<T>): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function periodStart(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const s = String(iso).slice(0, 10);
  return s.length >= 7 ? `${s.slice(0, 7)}-01` : s;
}

function ageHoursFrom(iso: string | null | undefined): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, (Date.now() - then) / 3_600_000);
}

type NonMeteredRow = {
  id: number;
  period_start_date: string | null;
  created_at: string | null;
  facility: Joined<{
    id: number;
    name: string;
    client_id: number;
    client: Joined<{ id: number; name: string }>;
  }>;
  supplier: Joined<{ name: string }>;
  input_type: Joined<{ name: string }>;
};

type MeteredRow = {
  id: number;
  period_start_date: string | null;
  created_at: string | null;
  meter: Joined<{
    facility: Joined<{
      id: number;
      name: string;
      client_id: number;
      client: Joined<{ id: number; name: string }>;
    }>;
    supplier: Joined<{ name: string }>;
    input_type: Joined<{ name: string }>;
  }>;
};

function mapNonMeteredRow(row: NonMeteredRow): StuckPendingRecord | null {
  const facility = joinedOne(row.facility);
  const client = joinedOne(facility?.client);
  if (!facility || !client) return null;

  const createdAt = row.created_at ?? row.period_start_date;
  if (!createdAt) return null;

  return {
    id: row.id,
    kind: 'non-metered',
    client_id: client.id,
    client_name: client.name,
    facility_name: facility.name ?? null,
    supplier_name: joinedOne(row.supplier)?.name ?? null,
    utility_name: joinedOne(row.input_type)?.name ?? null,
    period_start: periodStart(row.period_start_date),
    created_at: createdAt,
    age_hours: ageHoursFrom(createdAt),
  };
}

function mapMeteredRow(row: MeteredRow): StuckPendingRecord | null {
  const meter = joinedOne(row.meter);
  const facility = joinedOne(meter?.facility);
  const client = joinedOne(facility?.client);
  if (!meter || !facility || !client) return null;

  const createdAt = row.created_at ?? row.period_start_date;
  if (!createdAt) return null;

  return {
    id: row.id,
    kind: 'metered',
    client_id: client.id,
    client_name: client.name,
    facility_name: facility.name ?? null,
    supplier_name: joinedOne(meter.supplier)?.name ?? null,
    utility_name: joinedOne(meter.input_type)?.name ?? null,
    period_start: periodStart(row.period_start_date),
    created_at: createdAt,
    age_hours: ageHoursFrom(createdAt),
  };
}

// GET /api/activity/stuck
//   ?clientId=<id>       (optional — narrow to one client)
//   ?minAgeHours=<n>     (optional — only rows at least this many hours old; default 0)
//
// Returns all PENDING rows from non_metered_records and actual_invoices that the
// caller can access (RLS-scoped), oldest first.
export async function GET(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const { searchParams } = new URL(request.url);

    const clientIdParam = searchParams.get('clientId');
    const clientId =
      clientIdParam && Number.isFinite(Number(clientIdParam)) ? Number(clientIdParam) : null;

    const minAgeHoursParam = Number(searchParams.get('minAgeHours'));
    const minAgeHours =
      Number.isFinite(minAgeHoursParam) && minAgeHoursParam >= 0 ? minAgeHoursParam : 0;

    const [nonMeteredRes, meteredRes] = await Promise.all([
      supabase
        .from('non_metered_records')
        .select(
          `
          id,
          period_start_date,
          created_at,
          facility:facilities(id, name, client_id, client:clients(id, name)),
          supplier:suppliers(name),
          input_type:input_types(name)
        `
        )
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true }),
      supabase
        .from('actual_invoices')
        .select(
          `
          id,
          period_start_date,
          created_at,
          meter:meters(
            facility:facilities(id, name, client_id, client:clients(id, name)),
            supplier:suppliers(name),
            input_type:input_types(name)
          )
        `
        )
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true }),
    ]);

    if (nonMeteredRes.error) throw nonMeteredRes.error;
    if (meteredRes.error) throw meteredRes.error;

    const rows: StuckPendingRecord[] = [];

    for (const raw of (nonMeteredRes.data ?? []) as NonMeteredRow[]) {
      const mapped = mapNonMeteredRow(raw);
      if (mapped) rows.push(mapped);
    }

    for (const raw of (meteredRes.data ?? []) as MeteredRow[]) {
      const mapped = mapMeteredRow(raw);
      if (mapped) rows.push(mapped);
    }

    let filtered = rows;
    if (clientId != null) {
      filtered = filtered.filter((r) => r.client_id === clientId);
    }
    if (minAgeHours > 0) {
      filtered = filtered.filter((r) => r.age_hours >= minAgeHours);
    }

    filtered.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    return NextResponse.json(
      { data: filtered },
      {
        headers: {
          'Cache-Control': 'private, max-age=15, stale-while-revalidate=30',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching stuck pending records:', error);
    return NextResponse.json(
      { data: [], error: 'Failed to fetch stuck pending records' },
      { status: 500 }
    );
  }
}
