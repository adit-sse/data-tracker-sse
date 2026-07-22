/**
 * lib/upload/resolver.ts
 *
 * Request-scoped entity resolution cache for the upload pipeline.
 *
 * initContext() pre-loads all facilities, suppliers, input_types, categories,
 * and meters for the client in one pass. Subsequent cachedFindOrCreate* calls
 * hit the in-memory Maps first and only fall back to the DB on a miss — keeping
 * round-trip count proportional to net-new entities in the file rather than row count.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IdentifierType } from '@/types';
import { lookupFacilityByName, lookupSupplierByName } from '@/lib/name-lookup';
import { keywordMatches } from '@/lib/utility-category-classification';
import { idKey, sameId } from '@/lib/row-id';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface UploadContext {
  supabase: SupabaseClient;
  clientId: string;
  facilityCache: Map<string, string>;
  supplierCache: Map<string, string>;
  /** input_types.name (lower) → metadata */
  categoryCache: Map<string, { id: string; is_metered: boolean; scope: number }>;
  /** categories.name (lower) → NGERS reporting group */
  reportingCategoryCache: Map<string, { id: string; scope: number }>;
  meterCache: Map<string, string>;
}

export function rememberMeter(
  ctx: UploadContext,
  facilityId: string,
  categoryId: string,
  lookup1: string,
  meterId: string,
  ...identifierTypes: IdentifierType[]
): void {
  const types = new Set(identifierTypes);
  for (const t of types) {
    ctx.meterCache.set(`${facilityId}__${categoryId}__${t}__${lookup1}`, meterId);
  }
  ctx.meterCache.set(`${facilityId}__${categoryId}__*__${lookup1}`, meterId);
}

export async function initContext(supabase: SupabaseClient, clientId: string): Promise<UploadContext> {
  const ctx: UploadContext = {
    supabase,
    clientId,
    facilityCache: new Map(),
    supplierCache: new Map(),
    categoryCache: new Map(),
    reportingCategoryCache: new Map(),
    meterCache: new Map(),
  };

  const [facilitiesRes, suppliersRes, inputTypesRes, reportingCategoriesRes] = await Promise.all([
    ctx.supabase.from('facilities').select('id, name, address').eq('client_id', clientId),
    ctx.supabase.from('suppliers').select('id, name'),
    ctx.supabase.from('input_types').select('id, name, is_metered, scope, needs_review'),
    ctx.supabase.from('categories').select('id, name, scope'),
  ]);

  // Preload facilities by name+address only when that pair is unique in the DB.
  // Duplicate name+address pairs must resolve per-upload via DB (not cache overwrite).
  const facilityRows = facilitiesRes.data || [];
  const facilityKeyCounts = new Map<string, number>();
  for (const f of facilityRows) {
    const k = `${f.name.trim().toLowerCase()}__${(f.address || '').trim().toLowerCase()}`;
    facilityKeyCounts.set(k, (facilityKeyCounts.get(k) || 0) + 1);
  }
  for (const f of facilityRows) {
    const k = `${f.name.trim().toLowerCase()}__${(f.address || '').trim().toLowerCase()}`;
    if (facilityKeyCounts.get(k) === 1) {
      ctx.facilityCache.set(k, idKey(f.id));
    }
  }

  for (const s of suppliersRes.data || []) {
    ctx.supplierCache.set(s.name.trim().toLowerCase(), idKey(s.id));
  }

  for (const c of inputTypesRes.data || []) {
    ctx.categoryCache.set(c.name.trim().toLowerCase(), {
      id: c.id,
      is_metered: c.is_metered ?? true,
      scope: typeof c.scope === 'number' ? c.scope : 2,
    });
  }

  for (const c of reportingCategoriesRes.data || []) {
    ctx.reportingCategoryCache.set(c.name.trim().toLowerCase(), {
      id: c.id,
      scope: typeof c.scope === 'number' ? c.scope : 1,
    });
  }

  const facilityIds = facilityRows.map((f: { id: string }) => f.id);
  if (facilityIds.length > 0) {
    const { data: meters } = await ctx.supabase
      .from('meters')
      .select('id, facility_id, input_type_id, identifier_type, lookup1')
      .in('facility_id', facilityIds);
    for (const m of meters || []) {
      rememberMeter(
        ctx,
        m.facility_id,
        m.input_type_id,
        m.lookup1,
        m.id,
        m.identifier_type as IdentifierType,
      );
    }
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// String utilities shared by row processors
// ---------------------------------------------------------------------------

/** Collapse NBSP and trim so CSV/Excel quirks don't break name matching vs DB. */
export function normalizeFacilityName(name: string): string {
  return name.normalize('NFKC').replace(/\u00A0/g, ' ').trim();
}

export function facilityCacheKey(name: string, address: string | null): string {
  return `${normalizeFacilityName(name).toLowerCase()}__${(address || '').trim().toLowerCase()}`;
}

/** First letter uppercase, rest lowercase. */
export function toSentenceCase(s: string): string {
  const t = s.trim();
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export function mapUtilityToCategory(utility: string): string {
  const upper = utility.trim().toUpperCase();
  if (upper === 'ELECTRICITY') return 'ELECTRICITY';
  if (upper === 'GAS') return 'GAS';
  if (upper === 'FUEL') return 'FUEL';
  if (upper === 'OIL') return 'OIL';
  return utility.trim();
}

export function inferIdentifierType(utilityName: string): IdentifierType {
  const normalised = utilityName.trim().toUpperCase();
  if (keywordMatches(normalised, 'ELECTRICITY')) return 'NMI';
  if (keywordMatches(normalised, 'GAS')) return 'METER_NUMBER';
  return 'ACCOUNT_NUMBER';
}

// ---------------------------------------------------------------------------
// Cached entity resolvers
// ---------------------------------------------------------------------------

export async function cachedFindOrCreateFacility(
  ctx: UploadContext,
  name: string,
  address: string | null,
): Promise<string> {
  const displayName = normalizeFacilityName(name);
  if (!displayName) throw new Error('Missing Facility name');

  const key = facilityCacheKey(displayName, address);
  const cached = ctx.facilityCache.get(key);
  if (cached) return cached;

  const facilityLookup = await lookupFacilityByName(ctx.supabase, displayName, ctx.clientId);
  if (facilityLookup.error) {
    throw new Error(`Failed to look up facility: ${facilityLookup.error}`);
  }

  if (facilityLookup.data) {
    const facilityId = idKey(facilityLookup.data.id);
    ctx.facilityCache.set(key, facilityId);
    return facilityId;
  }

  const { data: created, error } = await ctx.supabase
    .from('facilities')
    .insert([{ client_id: ctx.clientId, name: displayName, address }])
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate')) {
      const retry = await lookupFacilityByName(ctx.supabase, displayName, ctx.clientId);
      if (retry.data) {
        const retryId = idKey(retry.data.id);
        ctx.facilityCache.set(key, retryId);
        return retryId;
      }
    }
    throw new Error(`Failed to create facility: ${error.message}`);
  }

  const createdId = idKey(created.id);
  ctx.facilityCache.set(key, createdId);
  return createdId;
}

export async function cachedFindOrCreateSupplier(ctx: UploadContext, name: string): Promise<string> {
  const key = name.trim().toLowerCase();
  const cached = ctx.supplierCache.get(key);
  if (cached) return cached;

  const supplierLookup = await lookupSupplierByName(ctx.supabase, name);
  if (supplierLookup.error) {
    throw new Error(`Failed to look up supplier: ${supplierLookup.error}`);
  }
  if (supplierLookup.data) {
    const supplierId = idKey(supplierLookup.data.id);
    ctx.supplierCache.set(key, supplierId);
    return supplierId;
  }

  const { data: created, error } = await ctx.supabase
    .from('suppliers')
    .insert([{ name }])
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505' || error.message?.toLowerCase().includes('duplicate')) {
      const retry = await lookupSupplierByName(ctx.supabase, name);
      if (retry.data) {
        const retrySupplierId = idKey(retry.data.id);
        ctx.supplierCache.set(key, retrySupplierId);
        return retrySupplierId;
      }
    }
    throw new Error(`Failed to create supplier: ${error.message}`);
  }

  const createdSupplierId = idKey(created.id);
  ctx.supplierCache.set(key, createdSupplierId);
  return createdSupplierId;
}

/**
 * Look up an input_type by name from the cache (pre-seeded at upload start).
 * Throws if not found — Input Types must be pre-defined; no auto-creation on upload.
 */
export async function cachedFindOrCreateCategory(
  ctx: UploadContext,
  name: string,
): Promise<{ id: string; is_metered: boolean; scope: number }> {
  const normalizedName = toSentenceCase(name);
  const key = normalizedName.toLowerCase();

  const cached = ctx.categoryCache.get(key);
  if (cached) return cached;

  const { data: existing } = await ctx.supabase
    .from('input_types')
    .select('id, is_metered, scope')
    .ilike('name', normalizedName)
    .limit(1);

  if (existing && existing.length > 0) {
    const row = existing[0];
    const result = {
      id: row.id,
      is_metered: row.is_metered ?? true,
      scope: typeof row.scope === 'number' ? row.scope : 2,
    };
    ctx.categoryCache.set(key, result);
    return result;
  }

  throw new Error(
    `Unknown Input Type: "${normalizedName}". Please create it in Manage Input Types before uploading.`,
  );
}

/**
 * Resolve a public.categories row for NGERS grouping (Scope 1 / 2 / 3).
 * Returns null when rawName is blank — Category is optional in the upload template.
 */
export async function cachedResolveReportingCategory(
  ctx: UploadContext,
  rawName: string | undefined,
  inputTypeScope: number,
): Promise<string | null> {
  const trimmed = rawName?.trim() ?? '';
  if (!trimmed) return null;

  const key = trimmed.toLowerCase();
  let row = ctx.reportingCategoryCache.get(key);

  if (!row) {
    const { data: existing } = await ctx.supabase
      .from('categories')
      .select('id, name, scope')
      .ilike('name', trimmed)
      .limit(2);

    if (!existing?.length) {
      throw new Error(
        `Unknown Category (reporting group): "${trimmed}". Create it under Categories or correct the spelling.`,
      );
    }
    if (existing.length > 1) {
      throw new Error(
        `Category "${trimmed}" matches multiple reporting groups. Use the exact Category name from your database.`,
      );
    }
    const c = existing[0];
    row = { id: c.id, scope: typeof c.scope === 'number' ? c.scope : 1 };
    ctx.reportingCategoryCache.set(c.name.trim().toLowerCase(), row);
  }

  if (inputTypeScope === 1 && row.scope !== 1)
    throw new Error(`Category "${trimmed}" is Scope ${row.scope}, but this Input Type is Scope 1.`);
  if (inputTypeScope === 2 && row.scope !== 2)
    throw new Error(`Category "${trimmed}" is Scope ${row.scope}, but this Input Type is Scope 2.`);
  if (inputTypeScope === 3 && row.scope !== 3)
    throw new Error(`Category "${trimmed}" is Scope ${row.scope}, but this Input Type is Scope 3.`);

  return row.id;
}

export async function cachedFindOrCreateMeter(
  ctx: UploadContext,
  opts: {
    facilityId: string;
    supplierId: string | null;
    categoryId: string;
    reportingCategoryId?: string | null;
    identifierType: IdentifierType;
    lookup1: string;
    lookup2: string | null;
  },
): Promise<string> {
  const cacheKey = `${opts.facilityId}__${opts.categoryId}__${opts.identifierType}__${opts.lookup1}`;
  const looseCacheKey = `${opts.facilityId}__${opts.categoryId}__*__${opts.lookup1}`;

  const cachedExact = ctx.meterCache.get(cacheKey);
  if (cachedExact) return cachedExact;
  const cachedLoose = ctx.meterCache.get(looseCacheKey);
  if (cachedLoose) return cachedLoose;

  const { data: exactRows } = await ctx.supabase
    .from('meters')
    .select('id, identifier_type')
    .eq('facility_id', opts.facilityId)
    .eq('input_type_id', opts.categoryId)
    .eq('identifier_type', opts.identifierType)
    .eq('lookup1', opts.lookup1)
    .limit(1);

  const exact = exactRows?.[0];
  if (exact) {
    rememberMeter(ctx, opts.facilityId, opts.categoryId, opts.lookup1, exact.id,
      opts.identifierType, exact.identifier_type as IdentifierType);
    return exact.id;
  }

  // Reuse an existing meter with the same account/NMI at this facility+utility
  // regardless of identifier_type — handles cases where stored type differs from inferred.
  const { data: anyTypeRows } = await ctx.supabase
    .from('meters')
    .select('id, identifier_type')
    .eq('facility_id', opts.facilityId)
    .eq('input_type_id', opts.categoryId)
    .eq('lookup1', opts.lookup1)
    .limit(1);

  const anyType = anyTypeRows?.[0];
  if (anyType) {
    rememberMeter(ctx, opts.facilityId, opts.categoryId, opts.lookup1, anyType.id,
      opts.identifierType, anyType.identifier_type as IdentifierType);
    return anyType.id;
  }

  const { data: newMeter, error } = await ctx.supabase
    .from('meters')
    .insert([{
      facility_id: opts.facilityId,
      supplier_id: opts.supplierId,
      input_type_id: opts.categoryId,
      category_id: opts.reportingCategoryId ?? null,
      identifier_type: opts.identifierType,
      lookup1: opts.lookup1,
      lookup2: opts.lookup2,
    }])
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: byLookup1 } = await ctx.supabase
        .from('meters')
        .select('id, facility_id, input_type_id, identifier_type, lookup1')
        .eq('lookup1', opts.lookup1)
        .limit(1);
      const found = byLookup1?.[0];
      if (found) {
        const sameFacility = sameId(found.facility_id, opts.facilityId);
        const sameType = found.identifier_type === opts.identifierType;
        console.warn(
          '[upload] meter conflict: lookup1=%s inferred_type=%s stored_type=%s same_facility=%s facility_id=%s',
          opts.lookup1, opts.identifierType, found.identifier_type, sameFacility, found.facility_id,
        );
        if (sameFacility) {
          rememberMeter(ctx, found.facility_id, found.input_type_id, opts.lookup1, found.id,
            found.identifier_type as IdentifierType, opts.identifierType);
          return idKey(found.id);
        }
        throw new Error(
          `Meter identifier "${opts.lookup1}" (${opts.identifierType}) already exists for a different facility` +
          `${sameType ? '' : ` (stored as ${found.identifier_type})`}. ` +
          `Existing meter ID: ${found.id}, facility_id: ${found.facility_id}.`,
        );
      }
      throw new Error(
        `Duplicate meter identifier ${opts.identifierType} "${opts.lookup1}" — ` +
        `a meter with this value already exists but could not be retrieved (check DB constraint "unique_identifier").`,
      );
    }
    throw new Error(`Failed to create meter: ${error.message}`);
  }

  rememberMeter(ctx, opts.facilityId, opts.categoryId, opts.lookup1, newMeter.id, opts.identifierType);
  return idKey(newMeter.id);
}
