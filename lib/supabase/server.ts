import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { assertNotSecretApiKey } from '@/lib/supabase/guard-public-key';

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  assertNotSecretApiKey(key, 'createSupabaseServerClient');

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            /* set from Server Component — middleware keeps session fresh */
          }
        },
      },
    }
  );
}
