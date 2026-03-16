export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { runGroupBackfill } from '@/lib/facility-group-backfill';

// GET /api/clients/[id]/facility-groups — list all groups with members
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabase
      .from('facility_groups')
      .select(`
        *,
        supplier:suppliers(id, name),
        members:facility_group_members(
          id,
          facility_id,
          facility:facilities(id, name)
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
    const body = await request.json();
    const { name, supplier_id, facility_ids } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
    }
    if (!supplier_id) {
      return NextResponse.json({ error: 'supplier_id is required' }, { status: 400 });
    }

    // Create the group
    const { data: group, error: groupError } = await supabase
      .from('facility_groups')
      .insert([{ client_id: params.id, supplier_id, name: name.trim() }])
      .select('*')
      .single();

    if (groupError) throw groupError;

    // Add members
    const memberIds: string[] = Array.isArray(facility_ids) ? facility_ids : [];
    if (memberIds.length > 0) {
      const { error: membersError } = await supabase
        .from('facility_group_members')
        .insert(memberIds.map((fid) => ({ group_id: group.id, facility_id: fid })));

      if (membersError) throw membersError;
    }

    // Retroactive inference backfill for existing records
    if (memberIds.length > 0) {
      await runGroupBackfill(supplier_id, memberIds);
    }

    // Return full group with members
    const { data: full, error: fullError } = await supabase
      .from('facility_groups')
      .select(`
        *,
        supplier:suppliers(id, name),
        members:facility_group_members(
          id,
          facility_id,
          facility:facilities(id, name)
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
