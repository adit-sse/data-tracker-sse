export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// GET /api/activity/event-tags/labels?q=n8n&limit=50
//
// Distinct custom tag labels the caller can see (RLS-scoped), for autocomplete.
export async function GET(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() ?? '';

    const limitParam = Number(searchParams.get('limit'));
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(Math.floor(limitParam), MAX_LIMIT)
        : DEFAULT_LIMIT;

    let query = supabase
      .from('ingestion_event_custom_tags')
      .select('label')
      .order('label')
      .limit(limit * 3);

    if (q) {
      query = query.ilike('label', `%${q}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const seen = new Set<string>();
    const labels: string[] = [];
    for (const row of data ?? []) {
      const label = typeof row.label === 'string' ? row.label : '';
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      labels.push(label);
      if (labels.length >= limit) break;
    }

    return NextResponse.json({ data: labels });
  } catch (error) {
    console.error('Error fetching event tag labels:', error);
    return NextResponse.json({ error: 'Failed to fetch tag labels' }, { status: 500 });
  }
}
