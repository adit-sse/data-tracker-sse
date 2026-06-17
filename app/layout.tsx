import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SSE Data Tracker',
  description: 'Track utility invoices and coverage across multiple clients and facilities',
};

function supabaseOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const preconnect = supabaseOrigin();

  return (
    <html lang="en">
      <head>
        {preconnect ? (
          <link rel="preconnect" href={preconnect} crossOrigin="anonymous" />
        ) : null}
      </head>
      <body className="bg-gray-50 min-h-screen">
        {children}
      </body>
    </html>
  );
}
