import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyCategory } from '@/lib/utility-category-classification';

/**
 * Find a utility_categories row by case-insensitive name, or create one using
 * the same scope rules as CSV upload (so API names like "LPG" / "Fuel - Bulk" work).
 */
export async function findOrCreateUtilityCategoryForIngestion(
  supabase: SupabaseClient,
  utilityName: string
): Promise<{ id: string; scope: number }> {
  const name = utilityName.trim();
  if (!name) {
    throw new Error('utility_name is empty');
  }

  const { data: existing } = await supabase
    .from('utility_categories')
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

  const classification = classifyCategory(name);

  const { data: created, error } = await supabase
    .from('utility_categories')
    .insert({
      name,
      scope: classification.scope,
      is_metered: classification.is_metered,
      needs_review: classification.needs_review,
    })
    .select('id, scope')
    .single();

  if (error) {
    if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate')) {
      const { data: retry } = await supabase
        .from('utility_categories')
        .select('id, scope')
        .ilike('name', name)
        .limit(1)
        .maybeSingle();
      if (retry) {
        return {
          id: retry.id,
          scope: typeof retry.scope === 'number' ? retry.scope : 2,
        };
      }
    }
    throw new Error(`Failed to create utility category: ${error.message}`);
  }

  return {
    id: created.id,
    scope: typeof created.scope === 'number' ? created.scope : classification.scope,
  };
}
