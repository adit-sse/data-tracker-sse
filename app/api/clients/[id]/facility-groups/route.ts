export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { runGroupBackfill } from '@/lib/facility-group-backfill';

// GET /api/clients/[id]/facility-groups — list all groups with members
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from('facility_groups')
      .select(`
        *,
        supplier:suppliers(id, name),
        utility_category:utility_categories(id, name),
        members:facility_group_members(
          id,
          facility_id,
          utility_category_id,
          facility:facilities(id, name),
          utility_category:utility_categories(id, name)
        )
      `)
      .eq('client_id', params.id)
      .order('name');

    if (error) throw error;

    return NextResponse.json(data || []);
  } catch (error) {
    console.error('Error fetching facility groups:', error);
    return NextResponse.json({ error: 'Failed to fetch facility groups' }, { status: 500 });
  }
}

// POST /api/clients/[id]/facility-groups — create a new group + run backfill
// Body: { name: string, supplier_id: string, facility_ids: string[] }
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();
    const { name, supplier_id, utility_category_id, facility_ids } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
    }
    if (!supplier_id) {
      return NextResponse.json({ error: 'supplier_id is required' }, { status: 400 });
    }
    if (!utility_category_id) {
      return NextResponse.json({ error: 'utility_category_id is required' }, { status: 400 });
    }

    // Create the group
    const { data: group, error: groupError } = await supabase
      .from('facility_groups')
      .insert([{ client_id: params.id, supplier_id, utility_category_id, name: name.trim() }])
      .select('*')
      .single();

    if (groupError) throw groupError;

    // Add members — facility_ids is now { facility_id, utility_category_id }[]
    const members: { facility_id: string; utility_category_id: string }[] =
      Array.isArray(facility_ids) ? facility_ids : [];
    if (members.length > 0) {
      const { error: membersError } = await supabase
        .from('facility_group_members')
        .insert(members.map(({ facility_id, utility_category_id: ucid }) => ({
          group_id: group.id,
          facility_id,
          utility_category_id: ucid || null,
        })));

      if (membersError) throw membersError;
    }

    // Retroactive inference backfill for existing records
    const memberIds = members.map((m) => m.facility_id);
    if (memberIds.length > 0) {
      await runGroupBackfill(supabase, supplier_id, memberIds);
    }

    // Return full group with members
    const { data: full, error: fullError } = await supabase
      .from('facility_groups')
      .select(`
        *,
        supplier:suppliers(id, name),
        utility_category:utility_categories(id, name),
        members:facility_group_members(
          id,
          facility_id,
          utility_category_id,
          facility:facilities(id, name),
          utility_category:utility_categories(id, name)
        )
      `)
      .eq('id', group.id)
      .single();

    if (fullError) throw fullError;

    return NextResponse.json(full, { status: 201 });
  } catch (error) {
    console.error('Error creating facility group:', error);
    return NextResponse.json({ error: 'Failed to create facility group' }, { status: 500 });
  }
}
