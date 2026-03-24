import { createClient } from '@supabase/supabase-js';

/**
 * Server-only client that bypasses RLS. Use only in trusted routes
 * (e.g. ingestion protected by INGESTION_API_KEY), never in the browser.
 *
 * Prefer `SUPABASE_SECRET_KEY` (Dashboard → API Keys → Secret, `sb_secret_...`).
 * Falls back to legacy `SUPABASE_SERVICE_ROLE_KEY` JWT if the secret key is unset.
 */
export function createSupabaseServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_...) or SUPABASE_SERVICE_ROLE_KEY are required',
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
