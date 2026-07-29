import { NextResponse, type NextRequest } from "next/server";

import { buildHashForwardHtml, sanitizeErrorCode, sanitizeNextPath } from "@/lib/auth/oauthCallback";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Auth redirects carry per-user state and must never sit in a shared cache.
const NO_STORE = { "cache-control": "no-store" };

// Lands here after an OAuth redirect (Google sign-in, or linkIdentity()
// upgrading an anonymous guest). Exchanges the auth code for a session —
// this writes the session cookies via the server client's setAll, so by
// the time we redirect the browser already has a valid session.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` round-trips through Supabase's redirect and back to us -- only
  // ever trust it as a same-site path, never an absolute URL, so a crafted
  // `?next=` can't turn this into an open redirect or (in the no-code branch
  // below, which serves HTML) inject markup. See lib/auth/oauthCallback.ts
  // for the rules; anything unexpected becomes `/daily`.
  const next = sanitizeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Marks this specifically as "just finished an OAuth round trip" so
      // OAuthErrorHandler can show a closing confirmation -- otherwise a
      // recovered identity-conflict sign-in (see below) ends in silence,
      // which reads as "did that actually work?" even though it did.
      return NextResponse.redirect(`${origin}${next}?oauth=success`, { headers: NO_STORE });
    }
    console.error("OAuth code exchange failed", error);
    // Forward the real reason (e.g. "identity_already_exists" when a
    // guest tries to link a Google account already claimed by a different
    // DriverPit account) so OAuthErrorHandler can react to it specifically
    // instead of showing a generic failure.
    return NextResponse.redirect(
      `${origin}${next}?error_code=${encodeURIComponent(sanitizeErrorCode(error.code))}`,
      { headers: NO_STORE },
    );
  }

  // No `code` -- some failures (notably a failed linkIdentity()) never make
  // it to the exchange above at all: GoTrue redirects straight back here
  // with the error appended as a URL *hash* fragment instead of a query
  // param, and fragments are never sent to the server, so we can't read
  // `error_code` from `searchParams` in that case. Rather than redirect
  // blind (which would replace this URL and drop that fragment before any
  // client code ever sees it), serve a one-line script that reads the hash
  // itself and forwards it as a query param on `next`, where
  // OAuthErrorHandler can reliably pick it up either way.
  //
  // This is the app's only server-rendered HTML built from request input, and
  // the session cookies @supabase/ssr writes are readable by script, so the
  // response is locked down accordingly: values reach the script as escaped
  // `data-*` attributes rather than interpolated source, and the CSP below
  // admits only this exact nonce -- no inline, no external, no anything else.
  const nonce = crypto.randomUUID();
  const html = buildHashForwardHtml({
    next,
    errorCode: sanitizeErrorCode(searchParams.get("error_code") ?? searchParams.get("error")),
    nonce,
  });

  return new NextResponse(html, {
    headers: {
      ...NO_STORE,
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join("; "),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
