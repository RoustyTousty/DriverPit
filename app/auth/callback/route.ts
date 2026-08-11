import { NextResponse, type NextRequest } from "next/server";

import {
  buildHashForwardHtml,
  sanitizeAuthFlow,
  sanitizeErrorCode,
  sanitizeErrorDescription,
  sanitizeNextPath,
} from "@/lib/auth/oauthCallback";
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
  // for the rules; anything unexpected becomes its DEFAULT_NEXT.
  const next = sanitizeNextPath(searchParams.get("next"));
  // Which round trip this is -- Google, an email-address confirmation, or a
  // password reset. Set by whoever built the `redirectTo`, and carried through
  // to the destination so the arrival message describes what actually
  // happened. Needed on the FAILURE path too: a confirmation link opened in a
  // different browser has already confirmed the address server-side (GoTrue's
  // /verify runs before this redirect) and only the PKCE exchange below fails,
  // so "something went wrong signing in with Google" would be wrong twice over.
  const flow = sanitizeAuthFlow(searchParams.get("flow"));

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Marks this specifically as "just finished an auth round trip" so
      // OAuthErrorHandler can show a closing confirmation -- otherwise a
      // recovered identity-conflict sign-in (see below) ends in silence,
      // which reads as "did that actually work?" even though it did.
      return NextResponse.redirect(`${origin}${next}?auth=${flow}`, { headers: NO_STORE });
    }
    console.error("Auth code exchange failed", { code: error.code, status: error.status, message: error.message });
    // Forward the real reason (e.g. "identity_already_exists" when a
    // guest tries to link a Google account already claimed by a different
    // DriverPit account) so OAuthErrorHandler can react to it specifically
    // instead of showing a generic failure.
    //
    // The message rides along beside the code, because the code alone is often
    // a category rather than a cause -- an `unexpected_failure` whose message
    // names a rate limit and one whose message names a missing redirect URL are
    // the same code and different problems. It is Supabase's own text, bounded
    // and encoded by sanitizeErrorDescription, and it is only ever logged or
    // shown as text.
    const params = new URLSearchParams({ auth: flow, error_code: sanitizeErrorCode(error.code) });
    const description = sanitizeErrorDescription(error.message);
    if (description) params.set("error_description", description);
    return NextResponse.redirect(`${origin}${next}?${params}`, { headers: NO_STORE });
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
  //
  // Deliberately carries no `flow`: this branch exists for a failed
  // linkIdentity(), which is the Google path and nothing else, and "google" is
  // exactly what an absent `auth` param means downstream. Threading it through
  // would put a fourth request-derived value into a response whose entire
  // design is about not letting request data reach the served markup.
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
