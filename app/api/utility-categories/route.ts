export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/utility-categories - List all utility categories
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('utility_categories')
      .select('*')
      .order('name');
    
    if (error) throw error;
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching utility categories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch utility categories' },
      { status: 500 }
    );
  }
}

// POST /api/utility-categories - Create new category (using upsert to avoid race conditions)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Category name is required' }, { status: 400 });
    }

    // Use upsert to handle race conditions
    const { data, error } = await supabase
      .from('utility_categories')
      .upsert(
        [{ name: name.trim() }],
        { onConflict: 'name', ignoreDuplicates: false }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Error creating utility category:', error);
    return NextResponse.json({ error: 'Failed to create utility category' }, { status: 500 });
  }
}
