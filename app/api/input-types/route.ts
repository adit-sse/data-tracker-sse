export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// GET /api/input-types - List all input types
export async function GET(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope');

    let query = supabase.from('input_types').select('*').order('name');
    if (scope) query = query.eq('scope', parseInt(scope, 10));

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching input types:', error);
    return NextResponse.json({ error: 'Failed to fetch input types' }, { status: 500 });
  }
}

// POST /api/input-types - Create a new input type
export async function POST(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();
    const { name, scope, is_metered } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (![1, 2, 3].includes(Number(scope))) {
      return NextResponse.json({ error: 'scope must be 1, 2, or 3' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('input_types')
      .upsert(
        [{ name: name.trim(), scope: Number(scope), is_metered: Boolean(is_metered) }],
        { onConflict: 'name', ignoreDuplicates: false }
      )
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Error creating input type:', error);
    return NextResponse.json({ error: 'Failed to create input type' }, { status: 500 });
  }
}
