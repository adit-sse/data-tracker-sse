/**
 * lib/upload/auto-groups.ts
 *
 * Auto-creates facility_groups for Scope 1 non-metered rows where multiple
 * lines share the same supplier + reporting category, then populates
 * facility_group_members via their non_metered_lines rows.
 *
 * This handles the "forward" case (group creation triggered by new upload data).
 * Retroactive backfill of existing records is handled separately by
 * lib/facility-group-backfill.ts (runGroupBackfill).
 */

import type { UploadContext } from '@/lib/upload/resolver';
import type { NonMeteredPayload } from '@/lib/upload/types';

export async function autoCreateNonMeteredGroups(
  ctx: UploadContext,
  records: NonMeteredPayload[],
  errors: string[],
): Promise<void> {
  // Build inputTypeId → scope reverse map from the pre-loaded category cache.
  const inputTypeIdToScope = new Map<string, number>();
  for (const [, meta] of ctx.categoryCache) {
    inputTypeIdToScope.set(meta.id, meta.scope);
  }

  const scope1 = records.filter(
    (r) =>
      r.supplierId !== null &&
      r.reportingCategoryId !== null &&
      inputTypeIdToScope.get(r.categoryId) === 1,
  );

  if (scope1.length === 0) return;

  // Group by (supplierId, reportingCategoryId); collect all distinct facility IDs
  // and distinct line-keys (facilityId + inputTypeId pairs).
  // A group is created when 2+ distinct lines share the same supplier + reporting category —
  // covers both "same facility, two fuel types" and "two facilities, same fuel type".
  type GroupEntry = {
    supplierId: string;
    reportingCategoryId: string;
    facilityIds: Set<string>;
    lineKeys: Set<string>;
  };

  const groupMap = new Map<string, GroupEntry>();
  for (const rec of scope1) {
    const key = `${rec.supplierId}__${rec.reportingCategoryId}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        supplierId: rec.supplierId!,
        reportingCategoryId: rec.reportingCategoryId!,
        facilityIds: new Set(),
        lineKeys: new Set(),
      });
    }
    const entry = groupMap.get(key)!;
    entry.facilityIds.add(rec.facilityId);
    entry.lineKeys.add(`${rec.facilityId}__${rec.categoryId}`);
  }

  const multiGroups = Array.from(groupMap.values()).filter((g) => g.lineKeys.size >= 2);
  if (multiGroups.length === 0) return;

  const supplierIds = Array.from(new Set(multiGroups.map((g) => g.supplierId)));
  const categoryIds = Array.from(new Set(multiGroups.map((g) => g.reportingCategoryId)));

  const [{ data: supplierRows }, { data: categoryRows }] = await Promise.all([
    ctx.supabase.from('suppliers').select('id, name').in('id', supplierIds),
    ctx.supabase.from('categories').select('id, name').in('id', categoryIds),
  ]);

  const supplierNameById = new Map<string, string>();
  for (const s of supplierRows ?? []) supplierNameById.set(s.id, s.name);

  const categoryNameById = new Map<string, string>();
  for (const c of categoryRows ?? []) categoryNameById.set(c.id, c.name);

  // Load existing facility_groups to avoid duplicates.
  const { data: existingGroups, error: egError } = await ctx.supabase
    .from('facility_groups')
    .select(`id, supplier_id, members:facility_group_members(line:non_metered_lines(facility_id))`)
    .eq('client_id', ctx.clientId);

  if (egError) {
    errors.push(`Auto-group: failed to load existing groups: ${egError.message}`);
    return;
  }

  type ExistingGroup = { id: string; facilityIds: Set<string> };
  const existingBySupplier = new Map<string, ExistingGroup[]>();
  for (const eg of existingGroups ?? []) {
    const members =
      (eg.members as unknown as Array<{ line: { facility_id: string } | null }>) ?? [];
    const facilityIds = new Set(
      members.map((m) => m.line?.facility_id).filter(Boolean) as string[],
    );
    if (!existingBySupplier.has(eg.supplier_id)) {
      existingBySupplier.set(eg.supplier_id, []);
    }
    existingBySupplier.get(eg.supplier_id)!.push({ id: String(eg.id), facilityIds });
  }

  for (const g of multiGroups) {
    const existing = existingBySupplier.get(g.supplierId) ?? [];
    const facilityIds = Array.from(g.facilityIds);

    const alreadyCovered = existing.some((eg) =>
      facilityIds.every((fid) => eg.facilityIds.has(fid)),
    );
    if (alreadyCovered) continue;

    const supplierName = supplierNameById.get(g.supplierId) ?? 'Unknown Supplier';
    const categoryName = categoryNameById.get(g.reportingCategoryId) ?? 'Unknown Category';
    const groupName = `${supplierName} - ${categoryName}`;

    const { data: newGroup, error: createError } = await ctx.supabase
      .from('facility_groups')
      .insert([{
        client_id: ctx.clientId,
        supplier_id: g.supplierId,
        category_id: g.reportingCategoryId,
        name: groupName,
      }])
      .select('id')
      .single();

    if (createError) {
      errors.push(`Auto-group: failed to create group "${groupName}": ${createError.message}`);
      continue;
    }

    const { data: memberLines, error: linesError } = await ctx.supabase
      .from('non_metered_lines')
      .select('id')
      .eq('supplier_id', g.supplierId)
      .eq('category_id', g.reportingCategoryId)
      .in('facility_id', facilityIds);

    if (linesError) {
      errors.push(`Auto-group: failed to look up member lines for "${groupName}": ${linesError.message}`);
      continue;
    }

    if (!memberLines?.length) {
      errors.push(`Auto-group: no non_metered_lines found for group "${groupName}" — members skipped`);
      continue;
    }

    const { error: membersError } = await ctx.supabase
      .from('facility_group_members')
      .upsert(
        memberLines.map((l) => ({ group_id: newGroup.id, non_metered_line_id: l.id })),
        { onConflict: 'group_id,non_metered_line_id', ignoreDuplicates: true },
      );

    if (membersError) {
      errors.push(
        `Auto-group: failed to add members to group "${groupName}": ${membersError.message}`,
      );
    }
  }
}
