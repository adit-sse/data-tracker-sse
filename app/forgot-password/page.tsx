'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) {
        setError(resetError.message);
        return;
      }
      // Always show the same confirmation so this page can't be used to probe
      // which email addresses have accounts.
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Reset password</h1>
        <p className="mt-1 text-sm text-gray-600">SSE Data Tracker</p>

        {sent ? (
          <>
            <p className="mt-6 text-sm text-gray-700">
              If an account exists for <span className="font-medium">{email}</span>, a reset link is on
              its way. The link expires after a short time — request a new one if it stops working.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block text-sm text-blue-600 hover:text-blue-700 underline"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p className="mt-4 text-sm text-gray-600">
              Enter your email and we&apos;ll send you a link to set a new password.
            </p>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                disabled={loading}
                className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <Link
              href="/login"
              className="mt-4 inline-block text-sm text-blue-600 hover:text-blue-700 underline"
            >
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
