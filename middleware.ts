import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { assertNotSecretApiKey } from '@/lib/supabase/guard-public-key';

export async function middleware(request: NextRequest) {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  assertNotSecretApiKey(anonKey, 'middleware');

  const path = request.nextUrl.pathname;
  // No session cookie work needed: login is public; ingestion uses its own API key + server secret.
  // Password recovery must be public too — a locked-out user has no session, and the recovery
  // token arrives in the URL fragment/query, which only the browser client can exchange.
  const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password'];
  if (PUBLIC_PATHS.includes(path) || path.startsWith('/api/ingestion')) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isApi = path.startsWith('/api/');

  if (!user) {
    if (isApi) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
