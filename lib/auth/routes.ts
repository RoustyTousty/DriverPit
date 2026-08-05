// The two standalone pages that make up the auth flow, as constants, because
// each is spelled in places that must agree and are nowhere near each other:
// a `redirectTo` handed to Supabase in one component, a route folder in `app/`,
// and (for sign-in) every guest upgrade prompt on the site. A typo in any one
// of them only shows up as a link that lands on a 404 -- for the reset path,
// minutes after the fact and in a different browser.
//
// Both must survive sanitizeNextPath (lib/auth/oauthCallback.ts), which admits
// `-` and `/` but nothing else interesting -- so they stay plain hyphenated
// paths with no query string of their own.

// The app's ONE login / sign-up screen. Deliberately not inside Settings any
// more: it is a full-page step in an auth flow, reached from every "save your
// progress" prompt on the site, and a modal is the wrong container for
// something a player may need to leave and come back to (an inbox, a password
// manager, a second device).
export const SIGN_IN_PATH = "/auth/sign-in";

// Where a "Forgot password?" email comes back to, via /auth/callback -- which
// does the code exchange, so the recovery session is already live by the time
// that page renders.
export const RESET_PASSWORD_PATH = "/auth/reset-password";

// A link to the sign-in screen that remembers where the player was. `next` is
// only a *destination* -- nothing is auto-submitted on arrival -- and it comes
// back through sanitizeNextPath on the far side, so an unusable value degrades
// to /daily rather than going anywhere surprising.
export function signInHref(next?: string | null): string {
  if (!next) return SIGN_IN_PATH;
  return `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}`;
}
