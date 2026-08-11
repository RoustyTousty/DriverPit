import type { NextRequest } from "next/server";

import { handleRequest } from "@/lib/i18n/composedMiddleware";

// Deliberately thin. Two middlewares have to share one request -- the Supabase
// session refresh that was here before Pass 7, and next-intl's locale routing --
// and getting their order wrong signs players out at random. That composition,
// and the reasons its order cannot be swapped, live in
// lib/i18n/composedMiddleware.ts where a test can reach them.
export function middleware(request: NextRequest) {
  return handleRequest(request);
}

export const config = {
  matcher: [
    // Everything except static assets, images and common asset extensions, so
    // sessions stay fresh on real page traffic without a cookie round trip per
    // font.
    //
    // Two exclusions were added for the locale half, and both are load-bearing
    // rather than tidying:
    //
    // `api` -- route handlers live at fixed paths (`/api/recap/[date]/image`).
    // next-intl would rewrite `/api/...` to `/en/api/...`, which does not
    // exist, and the recap card would 404.
    //
    // `auth/callback` -- the OAuth/PKCE return URL. It is registered in
    // Supabase's redirect allowlist and named in every `redirectTo` this app
    // builds, so it must stay exactly `/auth/callback` in every locale. It is
    // the one route that keeps a session-refresh pass but no locale pass; the
    // `next` param it forwards already carries the locale prefix when there is
    // one.
    //
    // `sitemap.xml`, `robots.txt` and `manifest.webmanifest` are Next's
    // app-root metadata files, and they live at FIXED paths by specification --
    // a crawler asks for `/robots.txt` and nothing else. Without them here
    // next-intl rewrites each to `/en/robots.txt`, which no route serves, and
    // all three 404. That is silent in the worst way: the pages all still
    // render, so the only symptom is Search Console reporting a missing sitemap
    // weeks later. There is nothing for the session half to do on any of them
    // either. Measured against next-intl 4 on 2026-08-08 -- all three were 404
    // until this line named them.
    "/((?!api|auth/callback|sitemap\\.xml|robots\\.txt|manifest\\.webmanifest|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
