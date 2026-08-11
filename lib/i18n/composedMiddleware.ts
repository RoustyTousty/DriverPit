import { createServerClient, type CookieOptions } from "@supabase/ssr";
import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "./routing";

// TWO middlewares, ONE request. This file exists because the naive way to add
// next-intl to a project that already has a middleware is to replace the
// middleware, and the symptom of doing that is players being signed out at
// apparently random moments -- which nobody would ever connect to an i18n
// change. So the composition is written out here, in one place, with the order
// pinned by lib/i18n/composedMiddleware.test.ts.
//
// The Supabase half is a session REFRESH, not a route guard. It does not create
// anonymous users -- signing a fresh visitor in is the client AuthProvider's job
// (components/auth/AuthProvider.tsx), specifically so that crawlers hitting
// every path do not each spawn a guest `auth.users` row.
//
// The order is: refresh first, then route. It is not interchangeable, for two
// separate reasons.
//
//  1. Supabase refresh tokens ROTATE. A refresh consumes the old token and
//     issues a new one, so if the new cookies do not reach the browser the
//     session is not merely un-refreshed, it is dead -- the old token has
//     already been spent. next-intl builds its own response from scratch
//     (`NextResponse.rewrite` / `.redirect` / `.next`), so anything written to
//     an earlier response object is discarded. Running the refresh first lets
//     us collect its cookies and re-attach them to whatever next-intl returns,
//     including a redirect.
//
//  2. `request.cookies.set()` mutates the request's `cookie` HEADER (verified
//     against next 15.5), and next-intl's rewrite forwards `request.headers`
//     onward to the route. So a refresh that runs first is visible to the
//     Server Components rendering THIS request; a refresh that runs after the
//     rewrite is not, and that page renders as signed-out even though the
//     browser got fresh cookies.

/** What a session refresh needs put on the outgoing response. */
export interface SessionRefresh {
  cookies: Array<{ name: string; value: string; options: CookieOptions }>;
  /**
   * `@supabase/ssr` supplies these alongside the cookies and they are not
   * optional: a response carrying a `Set-Cookie` for an auth token must not be
   * cached, or a CDN can serve one visitor's session to another. The previous
   * middleware ignored this second argument entirely.
   */
  headers: Record<string, string>;
}

const NO_REFRESH: SessionRefresh = { cookies: [], headers: {} };

/**
 * Touches the Supabase token refresh and reports what the response must carry.
 *
 * Side effect, and the important one: it writes refreshed cookies back onto
 * `request` so the rest of this request sees the new access token. Both halves
 * matter — the request mutation serves this render, the returned cookies serve
 * the browser.
 */
export async function refreshSupabaseSession(request: NextRequest): Promise<SessionRefresh> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // A build or a preview without Supabase configured should still serve pages
  // in every locale rather than throwing inside the middleware, which fails the
  // whole request rather than just the session.
  if (!url || !anonKey) return NO_REFRESH;

  const refresh: SessionRefresh = { cookies: [], headers: {} };

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          // Reason 2 above: this mutates request.headers' `cookie`, which
          // next-intl then forwards to the route.
          request.cookies.set(name, value);
          refresh.cookies.push({ name, value, options });
        }
        Object.assign(refresh.headers, headers);
      },
    },
  });

  // Side-effecting: performs the token refresh when the access token is expired
  // but the refresh token is still valid, which is what triggers `setAll`. The
  // result is deliberately unused — this is not a route guard.
  await supabase.auth.getUser();

  return refresh;
}

/**
 * Re-attaches a refresh onto whatever response the router produced.
 *
 * Applied unconditionally, including to redirects. A redirect is exactly the
 * case where dropping the cookies is fatal rather than cosmetic: the rotated
 * refresh token would be spent, the browser would still hold the spent one, and
 * the next request would fail to refresh at all.
 */
export function applySessionRefresh<T extends NextResponse>(
  response: T,
  refresh: SessionRefresh,
): T {
  for (const { name, value, options } of refresh.cookies) {
    response.cookies.set(name, value, options);
  }
  for (const [key, value] of Object.entries(refresh.headers)) {
    response.headers.set(key, value);
  }
  return response;
}

export interface MiddlewareDeps {
  refreshSession: (request: NextRequest) => Promise<SessionRefresh>;
  routeLocale: (request: NextRequest) => NextResponse;
}

const defaultDeps: MiddlewareDeps = {
  refreshSession: refreshSupabaseSession,
  routeLocale: createIntlMiddleware(routing),
};

/**
 * The composed middleware. Exported with injectable deps so the ordering can be
 * asserted without a Supabase project or a live token.
 */
export async function handleRequest(
  request: NextRequest,
  deps: MiddlewareDeps = defaultDeps,
): Promise<NextResponse> {
  const refresh = await deps.refreshSession(request);
  const response = deps.routeLocale(request);
  return applySessionRefresh(response, refresh);
}
