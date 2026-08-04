'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const MIN_PASSWORD_LENGTH = 8;

type LinkState = 'checking' | 'ready' | 'invalid';

export default function ResetPasswordPage() {
  const router = useRouter();

  const [linkState, setLinkState] = useState<LinkState>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The recovery link can arrive in a few shapes depending on the Supabase project's
  // email template and auth flow: a `token_hash` query param, a PKCE `?code=`, or an
  // implicit `#access_token=...` fragment. The last two are consumed automatically by
  // the browser client (detectSessionInUrl), so we only verify `token_hash` by hand and
  // otherwise wait for a session to show up.
  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();

    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get('token_hash');
    const errorDescription = params.get('error_description');

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled && session) setLinkState('ready');
    });

    (async () => {
      if (errorDescription) {
        if (!cancelled) {
          setError(errorDescription);
          setLinkState('invalid');
        }
        return;
      }

      if (tokenHash) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'recovery',
        });
        if (cancelled) return;
        if (verifyError) {
          setError(verifyError.message);
          setLinkState('invalid');
          return;
        }
        setLinkState('ready');
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        setLinkState('ready');
        return;
      }

      // Give detectSessionInUrl a moment to finish handling a code/fragment link before
      // declaring the link dead; onAuthStateChange above flips us to 'ready' if it lands.
      setTimeout(() => {
        if (!cancelled) setLinkState((prev) => (prev === 'checking' ? 'invalid' : prev));
      }, 3000);
    })();

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setDone(true);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Set a new password</h1>
        <p className="mt-1 text-sm text-gray-600">SSE Data Tracker</p>

        {linkState === 'checking' && (
          <p className="mt-6 text-sm text-gray-600">Checking your reset link…</p>
        )}

        {linkState === 'invalid' && (
          <>
            <p className="mt-6 text-sm text-red-600" role="alert">
              {error ?? 'This reset link is invalid or has expired.'}
            </p>
            <Link
              href="/forgot-password"
              className="mt-4 inline-block text-sm text-blue-600 hover:text-blue-700 underline"
            >
              Request a new link
            </Link>
          </>
        )}

        {linkState === 'ready' && !done && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-gray-700">
                New password
              </label>
              <input
                id="new-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">At least {MIN_PASSWORD_LENGTH} characters.</p>
            </div>

            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700">
                Confirm new password
              </label>
              <input
                id="confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        )}

        {done && (
          <>
            <p className="mt-6 text-sm text-green-700" role="status">
              Password updated. You&apos;re signed in.
            </p>
            <Link
              href="/"
              className="mt-4 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Continue to the tracker
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
