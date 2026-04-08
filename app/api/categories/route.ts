export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// GET /api/categories - List all NGERS categories
// Optional ?scope=1 or ?scope=3 filter
export async function GET(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope');

    let query = supabase.from('categories').select('*').order('scope').order('name');
    if (scope) query = query.eq('scope', parseInt(scope, 10));

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
  }
}

// POST /api/categories - Create a new category
export async function POST(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();
    const { name, scope } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (![1, 3].includes(Number(scope))) {
      return NextResponse.json({ error: 'scope must be 1 or 3 (Scope 2 has no category)' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('categories')
      .upsert(
        [{ name: name.trim(), scope: Number(scope) }],
        { onConflict: 'name', ignoreDuplicates: false }
      )
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Error creating category:', error);
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 });
  }
}
