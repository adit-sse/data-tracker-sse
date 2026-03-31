/**
 * Secret keys (sb_secret_...) are rejected by Supabase when used from browsers / typical SSR paths.
 * Only publishable (sb_publishable_...) or legacy anon JWT may back NEXT_PUBLIC_SUPABASE_ANON_KEY.
 */
export function assertNotSecretApiKey(key: string | undefined, where: string): void {
  if (!key?.trim()) return;
  if (key.startsWith('sb_secret_')) {
    throw new Error(
      [
        `${where}: NEXT_PUBLIC_SUPABASE_ANON_KEY is set to a secret key (sb_secret_...).`,
        'Fix .env.local:',
        '  • Put sb_secret_... in SUPABASE_SECRET_KEY only (never NEXT_PUBLIC_).',
        '  • Set NEXT_PUBLIC_SUPABASE_ANON_KEY to either:',
        '    – API Keys tab → Publishable key (sb_publishable_...), or',
        '    – Legacy API keys tab → anon / public JWT (long eyJ... string).',
      ].join('\n'),
    );
  }
}
