export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { runGroupBackfill } from '@/lib/facility-group-backfill';
import {
  normalizeGroupMembers,
  resolveMemberLineIds,
} from '@/lib/facility-group-members';

const MEMBERS_SELECT = `
  id,
  non_metered_line_id,
  line:non_metered_lines(
    id,
    facility_id,
    supplier_id,
    input_type_id,
    facility:facilities(id, name),
    input_type:input_types(id, name),
    supplier:suppliers(id, name)
  )
`;

const GROUP_SELECT = `
  *,
  supplier:suppliers(id, name),
  category:categories(id, name),
  members:facility_group_members(${MEMBERS_SELECT})
`;

// GET /api/clients/[id]/facility-groups — list all groups with members
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from('facility_groups')
      .select(GROUP_SELECT)
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
// Body: { name: string, supplier_id: string, category_id?: string,
//         facility_ids: { facility_id: string, input_type_id: string }[] }
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();
    const body = await request.json();
    const { name, supplier_id, category_id, facility_ids } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
    }
    if (!supplier_id) {
      return NextResponse.json({ error: 'supplier_id is required' }, { status: 400 });
    }

    const { data: group, error: groupError } = await supabase
      .from('facility_groups')
      .insert([{ client_id: params.id, supplier_id, category_id: category_id || null, name: name.trim() }])
      .select('*')
      .single();

    if (groupError) throw groupError;

    const members = normalizeGroupMembers({ facility_ids, members: body.members }, supplier_id);

    if (members.length > 0) {
      const lineIds = await resolveMemberLineIds(supabase, members, category_id || null);
      if (lineIds.length > 0) {
        const { error: membersError } = await supabase
          .from('facility_group_members')
          .upsert(
            lineIds.map((lineId) => ({ group_id: group.id, non_metered_line_id: lineId })),
            { onConflict: 'group_id,non_metered_line_id', ignoreDuplicates: true }
          );
        if (membersError) throw membersError;
      }
    }

    // Retroactive inference backfill for existing records
    const memberFacilityIds = [...new Set(members.map((m) => m.facility_id))];
    if (memberFacilityIds.length > 0) {
      await runGroupBackfill(supabase, supplier_id, memberFacilityIds);
    }

    const { data: full, error: fullError } = await supabase
      .from('facility_groups')
      .select(GROUP_SELECT)
      .eq('id', group.id)
      .single();

    if (fullError) throw fullError;

    return NextResponse.json(full, { status: 201 });
  } catch (error) {
    console.error('Error creating facility group:', error);
    return NextResponse.json({ error: 'Failed to create facility group' }, { status: 500 });
  }
}
