import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Session refresh only — this does NOT create anonymous users. Signing a
// fresh visitor in anonymously is the client AuthProvider's job (see
// components/auth/AuthProvider.tsx), specifically so bots/crawlers/asset
// requests hitting the middleware on every path don't each spawn a guest
// auth.users row. This middleware's only responsibility is keeping an
// *existing* session's cookies fresh so server-side reads (Server
// Components, route handlers) see the same identity the browser has.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Touches the token refresh (if the access token is expired but the
  // refresh token is still valid) and rewrites cookies onto `response`
  // above via setAll. Result is intentionally unused here — this is a
  // side-effecting refresh, not a route guard.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Run on everything except static assets, images, and common asset
    // extensions, so guest sessions stay fresh on real page/API traffic
    // without doing the cookie round-trip for every font/image request.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
