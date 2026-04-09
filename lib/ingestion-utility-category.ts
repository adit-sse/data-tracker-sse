import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Find an input_types row by case-insensitive name.
 * Throws if not found — Input Types must be pre-defined (no auto-create during ingestion).
 */
export async function findInputTypeForIngestion(
  supabase: SupabaseClient,
  inputTypeName: string
): Promise<{ id: string; scope: number }> {
  const name = inputTypeName.trim();
  if (!name) {
    throw new Error('input_type name is empty');
  }

  const { data: existing } = await supabase
    .from('input_types')
    .select('id, scope')
    .ilike('name', name)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return {
      id: existing.id,
      scope: typeof existing.scope === 'number' ? existing.scope : 2,
    };
  }

  throw new Error(
    `Unknown Input Type: "${name}". Please create it in Manage Input Types before uploading.`
  );
}

/**
 * Find a categories row (NGERS reporting group) by case-insensitive name.
 * Used by ingestion routes to look up the group-level category on facility_groups.
 * Throws if not found.
 */
export async function findCategoryForIngestion(
  supabase: SupabaseClient,
  categoryName: string
): Promise<{ id: string; scope: number }> {
  const name = categoryName.trim();
  if (!name) {
    throw new Error('category name is empty');
  }

  const { data: existing } = await supabase
    .from('categories')
    .select('id, scope')
    .ilike('name', name)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return {
      id: existing.id,
      scope: typeof existing.scope === 'number' ? existing.scope : 1,
    };
  }

  throw new Error(
    `Unknown Category: "${name}". Check the category name matches exactly what is configured in the tracker.`
  );
}

/**
 * @deprecated Use findInputTypeForIngestion instead.
 * Kept temporarily so callers that still pass the old name compile.
 */
export async function findOrCreateUtilityCategoryForIngestion(
  supabase: SupabaseClient,
  utilityName: string
): Promise<{ id: string; scope: number }> {
  return findInputTypeForIngestion(supabase, utilityName);
}
