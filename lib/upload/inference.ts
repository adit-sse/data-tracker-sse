/**
 * lib/upload/inference.ts
 *
 * Forward inference: after upserting a batch of non_metered_records, seed
 * INFERRED_EMPTY placeholders for any group-member facilities that did NOT
 * submit data for the same (supplier, category, period) slice.
 *
 * This is the "forward" counterpart to lib/facility-group-backfill.ts
 * (runGroupBackfill), which handles the retroactive case when a group is
 * first created or its members change.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureLineInFacilityGroup, upsertNonMeteredLine } from '@/lib/non-metered-lines';

const BATCH_CHUNK_SIZE = 200;

export async function runInferenceForBatch(
  supabase: SupabaseClient,
  upsertedRecords: Array<{
    id: string;
    facilityId: string;
    supplierId: string | null;
    categoryId: string;
    periodStart: string;
    periodEnd: string;
    status?: string;
  }>,
  errors: string[],
): Promise<void> {
  if (upsertedRecords.length === 0) return;

  // Group records by (supplierId, categoryId, periodStart, periodEnd) and collect
  // all facility IDs that submitted data for each slice.
  const groups = new Map<
    string,
    {
      supplierId: string | null;
      categoryId: string;
      periodStart: string;
      periodEnd: string;
      facilityIds: Set<string>;
      referenceId: string;
    }
  >();

  for (const rec of upsertedRecords) {
    const key = `${rec.supplierId}__${rec.categoryId}__${rec.periodStart}__${rec.periodEnd}`;
    if (!groups.has(key)) {
      groups.set(key, {
        supplierId: rec.supplierId,
        categoryId: rec.categoryId,
        periodStart: rec.periodStart,
        periodEnd: rec.periodEnd,
        facilityIds: new Set(),
        referenceId: rec.id,
      });
    }
    groups.get(key)!.facilityIds.add(rec.facilityId);
  }

  const allPresentFacilityIds = new Set<string>();
  for (const group of groups.values()) {
    if (!group.supplierId) continue;
    for (const fid of group.facilityIds) allPresentFacilityIds.add(fid);
  }

  if (allPresentFacilityIds.size === 0) return;

  // Resolve non_metered_line IDs for the uploaded facilities.
  const { data: presentLines } = await supabase
    .from('non_metered_lines')
    .select('id, facility_id')
    .in('facility_id', Array.from(allPresentFacilityIds));

  const presentLineIds = (presentLines ?? []).map((l: { id: string }) => String(l.id));
  if (presentLineIds.length === 0) return;

  // Fetch all relevant group memberships in a single query.
  const { data: allGroupMembers, error: gmError } = await supabase
    .from('facility_group_members')
    .select(
      'group_id, non_metered_line_id, line:non_metered_lines(facility_id), group:facility_groups(supplier_id)',
    )
    .in('non_metered_line_id', presentLineIds);

  if (gmError || !allGroupMembers?.length) return;

  // Pre-fetch all member facility IDs for the referenced groups.
  const relevantGroupIds = Array.from(new Set(allGroupMembers.map((m: { group_id: string }) => m.group_id)));
  const { data: allMembersData } = await supabase
    .from('facility_group_members')
    .select('group_id, line:non_metered_lines(facility_id)')
    .in('group_id', relevantGroupIds);

  const membersByGroup = new Map<string, string[]>();
  for (const m of (allMembersData || []) as unknown as Array<{ group_id: string; line: { facility_id: string } | null }>) {
    const facilityId = m.line?.facility_id;
    if (!facilityId) continue;
    if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, []);
    membersByGroup.get(m.group_id)!.push(String(facilityId));
  }

  type InferenceDraft = {
    facility_id: string;
    supplier_id: string;
    input_type_id: string;
    period_start_date: string;
    period_end_date: string;
    status: string;
    inferred_from_id: string;
    group_id: string;
  };

  const inferenceDrafts: InferenceDraft[] = [];

  for (const group of groups.values()) {
    if (!group.supplierId) continue;

    const matchingGroupMembers = (allGroupMembers as unknown as Array<{
      group_id: string;
      line: { facility_id: string } | null;
      group: { supplier_id: string } | null;
    }>).filter(
      (m) =>
        group.facilityIds.has(m.line?.facility_id ?? '') &&
        m.group?.supplier_id === group.supplierId,
    );

    if (!matchingGroupMembers.length) continue;

    const groupIds = Array.from(new Set(matchingGroupMembers.map((m) => m.group_id)));

    for (const groupId of groupIds) {
      const allMembers = membersByGroup.get(groupId) || [];
      const absentFacilityIds = allMembers.filter((fid) => !group.facilityIds.has(fid));

      for (const absentFacilityId of absentFacilityIds) {
        inferenceDrafts.push({
          facility_id: absentFacilityId,
          supplier_id: group.supplierId,
          input_type_id: group.categoryId,
          period_start_date: group.periodStart,
          period_end_date: group.periodEnd,
          status: 'INFERRED_EMPTY',
          inferred_from_id: group.referenceId,
          group_id: groupId,
        });
      }
    }
  }

  for (let i = 0; i < inferenceDrafts.length; i += BATCH_CHUNK_SIZE) {
    const chunk = inferenceDrafts.slice(i, i + BATCH_CHUNK_SIZE);
    const resolvedChunk: Array<InferenceDraft & { non_metered_line_id: string }> = [];

    for (const draft of chunk) {
      try {
        const { id: lineId } = await upsertNonMeteredLine(supabase, {
          facilityId: draft.facility_id,
          supplierId: draft.supplier_id,
          inputTypeId: draft.input_type_id,
        });
        await ensureLineInFacilityGroup(supabase, lineId, draft.group_id);
        resolvedChunk.push({ ...draft, non_metered_line_id: lineId });
      } catch (e) {
        errors.push(
          `Batch inference line resolve failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (resolvedChunk.length === 0) continue;

    const { error: inferError } = await supabase
      .from('non_metered_records')
      .upsert(
        resolvedChunk.map(({ group_id: _groupId, ...row }) => row),
        {
          onConflict: 'facility_id,supplier_id,input_type_id,period_start_date,period_end_date',
          ignoreDuplicates: true,
        }
      );

    if (inferError) {
      errors.push(`Batch inference upsert failed: ${inferError.message}`);
    }
  }
}
