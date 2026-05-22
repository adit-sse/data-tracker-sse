import type { SupabaseClient } from '@supabase/supabase-js';
import { upsertNonMeteredLines } from '@/lib/non-metered-lines';

export type GroupMemberInput = {
  /** When present, update this line in place instead of creating a new one. */
  non_metered_line_id?: string | null;
  facility_id: string;
  input_type_id: string;
  supplier_id: string;
};

type LineRow = {
  id: string;
  facility_id: string;
  supplier_id: string;
  input_type_id: string;
};

/** Normalize facility_ids (legacy) or members payload into full member rows. */
export function normalizeGroupMembers(
  body: {
    supplier_id?: string;
    facility_ids?: {
      facility_id: string;
      input_type_id: string;
      supplier_id?: string;
      non_metered_line_id?: string | null;
    }[];
    members?: GroupMemberInput[];
  },
  defaultSupplierId: string
): GroupMemberInput[] {
  const raw = Array.isArray(body.members)
    ? body.members
    : Array.isArray(body.facility_ids)
      ? body.facility_ids
      : [];

  return raw
    .map((m) => ({
      non_metered_line_id: m.non_metered_line_id ? String(m.non_metered_line_id) : null,
      facility_id: String(m.facility_id),
      input_type_id: String(m.input_type_id),
      supplier_id: String(m.supplier_id ?? defaultSupplierId),
    }))
    .filter((m) => m.facility_id && m.input_type_id && m.supplier_id);
}

function lineIdentity(
  facilityId: string,
  supplierId: string,
  inputTypeId: string
): string {
  return `${facilityId}__${supplierId}__${inputTypeId}`;
}

/** Move invoice records when a line's identity changes. */
async function migrateNonMeteredRecords(
  supabase: SupabaseClient,
  oldLine: { facility_id: string; supplier_id: string; input_type_id: string },
  newLine: { facility_id: string; supplier_id: string; input_type_id: string }
): Promise<void> {
  const sameIdentity =
    String(oldLine.facility_id) === String(newLine.facility_id) &&
    String(oldLine.supplier_id) === String(newLine.supplier_id) &&
    String(oldLine.input_type_id) === String(newLine.input_type_id);
  if (sameIdentity) return;

  const { error } = await supabase
    .from('non_metered_records')
    .update({
      facility_id: newLine.facility_id,
      supplier_id: newLine.supplier_id,
      input_type_id: newLine.input_type_id,
    })
    .eq('facility_id', oldLine.facility_id)
    .eq('supplier_id', oldLine.supplier_id)
    .eq('input_type_id', oldLine.input_type_id);

  if (error) {
    throw new Error(
      `Failed to migrate records for updated group member: ${error.message}. ` +
        'A record may already exist for the new facility/supplier/input type combination.'
    );
  }
}

/** Remove a line that is no longer referenced by any group and has no records. */
async function retireOrphanLineIfUnused(
  supabase: SupabaseClient,
  lineId: string
): Promise<void> {
  const { count: memberCount, error: memberErr } = await supabase
    .from('facility_group_members')
    .select('id', { count: 'exact', head: true })
    .eq('non_metered_line_id', lineId);
  if (memberErr) throw memberErr;
  if ((memberCount ?? 0) > 0) return;

  const { data: line, error: lineErr } = await supabase
    .from('non_metered_lines')
    .select('facility_id, supplier_id, input_type_id')
    .eq('id', lineId)
    .single();
  if (lineErr || !line) return;

  const { count: recordCount, error: recordErr } = await supabase
    .from('non_metered_records')
    .select('id', { count: 'exact', head: true })
    .eq('facility_id', line.facility_id)
    .eq('supplier_id', line.supplier_id)
    .eq('input_type_id', line.input_type_id);
  if (recordErr) throw recordErr;
  if ((recordCount ?? 0) > 0) return;

  const { error: deleteErr } = await supabase.from('non_metered_lines').delete().eq('id', lineId);
  if (deleteErr) throw deleteErr;
}

async function findLineByIdentity(
  supabase: SupabaseClient,
  facilityId: string,
  supplierId: string,
  inputTypeId: string
): Promise<LineRow | null> {
  const { data, error } = await supabase
    .from('non_metered_lines')
    .select('id, facility_id, supplier_id, input_type_id')
    .eq('facility_id', facilityId)
    .eq('supplier_id', supplierId)
    .eq('input_type_id', inputTypeId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as LineRow) : null;
}

/**
 * Update an existing non_metered_lines row when group member attributes change,
 * migrating related records instead of creating a parallel line.
 */
async function reconcileExistingMemberLine(
  supabase: SupabaseClient,
  member: GroupMemberInput,
  categoryId?: string | null
): Promise<string> {
  const lineId = String(member.non_metered_line_id);

  const { data: existing, error: fetchErr } = await supabase
    .from('non_metered_lines')
    .select('id, facility_id, supplier_id, input_type_id')
    .eq('id', lineId)
    .single();
  if (fetchErr || !existing) {
    throw new Error(`Group member line ${lineId} was not found`);
  }

  const oldLine = {
    facility_id: String(existing.facility_id),
    supplier_id: String(existing.supplier_id),
    input_type_id: String(existing.input_type_id),
  };
  const newLine = {
    facility_id: member.facility_id,
    supplier_id: member.supplier_id,
    input_type_id: member.input_type_id,
  };

  if (lineIdentity(oldLine.facility_id, oldLine.supplier_id, oldLine.input_type_id) ===
      lineIdentity(newLine.facility_id, newLine.supplier_id, newLine.input_type_id)) {
    if (categoryId !== undefined) {
      const { error } = await supabase
        .from('non_metered_lines')
        .update({ category_id: categoryId })
        .eq('id', lineId);
      if (error) throw error;
    }
    return lineId;
  }

  const targetLine = await findLineByIdentity(
    supabase,
    newLine.facility_id,
    newLine.supplier_id,
    newLine.input_type_id
  );

  if (targetLine && String(targetLine.id) !== lineId) {
    await migrateNonMeteredRecords(supabase, oldLine, newLine);
    await retireOrphanLineIfUnused(supabase, lineId);
    if (categoryId !== undefined) {
      const { error } = await supabase
        .from('non_metered_lines')
        .update({ category_id: categoryId })
        .eq('id', targetLine.id);
      if (error) throw error;
    }
    return String(targetLine.id);
  }

  await migrateNonMeteredRecords(supabase, oldLine, newLine);

  const updatePayload: Record<string, unknown> = {
    facility_id: newLine.facility_id,
    supplier_id: newLine.supplier_id,
    input_type_id: newLine.input_type_id,
  };
  if (categoryId !== undefined) {
    updatePayload.category_id = categoryId;
  }

  const { error: updateErr } = await supabase
    .from('non_metered_lines')
    .update(updatePayload)
    .eq('id', lineId);
  if (updateErr) {
    throw new Error(`Failed to update group member line: ${updateErr.message}`);
  }

  return lineId;
}

/**
 * Resolve line IDs for group members. Existing lines are updated in place;
 * new members without a line id get registered via upsert.
 */
export async function resolveMemberLineIds(
  supabase: SupabaseClient,
  members: GroupMemberInput[],
  categoryId?: string | null
): Promise<string[]> {
  if (members.length === 0) return [];

  const lineIds: string[] = [];
  const newMembers: GroupMemberInput[] = [];

  for (const member of members) {
    if (member.non_metered_line_id) {
      const id = await reconcileExistingMemberLine(supabase, member, categoryId);
      lineIds.push(id);
    } else {
      newMembers.push(member);
    }
  }

  if (newMembers.length > 0) {
    await upsertNonMeteredLines(
      supabase,
      newMembers.map((m) => ({
        facilityId: m.facility_id,
        supplierId: m.supplier_id,
        inputTypeId: m.input_type_id,
        categoryId: categoryId ?? null,
      }))
    );

    const facilityIds = [...new Set(newMembers.map((m) => m.facility_id))];
    const { data: lines, error } = await supabase
      .from('non_metered_lines')
      .select('id, facility_id, input_type_id, supplier_id')
      .in('facility_id', facilityIds);
    if (error) throw error;

    for (const member of newMembers) {
      const match = (lines ?? []).find(
        (l) =>
          String(l.facility_id) === member.facility_id &&
          String(l.input_type_id) === member.input_type_id &&
          String(l.supplier_id) === member.supplier_id
      );
      if (!match?.id) {
        throw new Error(
          `Could not register non-metered line for facility ${member.facility_id}`
        );
      }
      lineIds.push(String(match.id));
    }
  }

  return lineIds;
}
