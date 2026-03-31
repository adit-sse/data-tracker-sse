import { createBrowserClient } from '@supabase/ssr';
import { assertNotSecretApiKey } from '@/lib/supabase/guard-public-key';

export function createSupabaseBrowserClient() {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  assertNotSecretApiKey(key, 'createSupabaseBrowserClient');
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}
