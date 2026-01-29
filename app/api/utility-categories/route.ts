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
