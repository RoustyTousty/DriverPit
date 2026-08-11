// Pure helpers for the OAuth callback's hash-forwarding response
// (app/auth/callback/route.ts). Kept out of the route handler so the
// escaping rules that stop a crafted `?next=` / `?error_code=` reaching the
// served HTML are unit-testable on their own -- see oauthCallback.test.ts,
// which pins the exact payloads.
//
// The response has to run a tiny inline script (GoTrue reports some failures
// in a URL *hash*, which never reaches the server, so only client code can
// read it). Building that script by interpolation is what made it injectable:
// JSON.stringify escapes quotes and backslashes but NOT `</script>`, and the
// HTML parser ends a script element at the first `</script` sequence
// regardless of JavaScript string context. So values are never interpolated
// into script *source* here -- they go into `data-*` attributes the script
// reads back at runtime, behind three independent layers:
//
//   1. strict allowlist validation (below) -- a hostile value never survives
//      as itself, it becomes the default;
//   2. HTML attribute escaping -- so even an allowlist mistake can't close
//      the attribute or the tag;
//   3. a per-response nonce CSP set by the route -- so an injected script
//      still doesn't execute.

// Where an auth round trip lands when it has nowhere better to go: the game
// itself, which is `/` (roadmap Pass 5). Exported because /auth/sign-in needs
// the same value as the initial state of its own `next`, and two spellings of
// "the default destination" is one more than the number that can be right.
export const DEFAULT_NEXT = "/";
const DEFAULT_ERROR_CODE = "oauth_callback_failed";

// Real values are always `window.location.pathname` (OAuthErrorHandler,
// ProfileSection), so every legitimate route matches this. Note `\` is
// absent deliberately: `location.replace("/\\evil.com")` is parsed by the
// WHATWG URL parser as protocol-relative and navigates off-site, so a
// `startsWith("//")` check alone is not enough to stop an open redirect.
// `?` and `#` are absent too -- the caller appends its own query string.
const SAFE_NEXT_PATH = /^\/[A-Za-z0-9\-._~/]*$/;
const NEXT_MAX_LENGTH = 512;

// GoTrue error codes are snake_case identifiers (`identity_already_exists`,
// `validation_failed`). Anything else is not a code we can act on, so it is
// worth nothing to forward and is dropped for the generic default.
const SAFE_ERROR_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

// The human-readable half of a GoTrue failure (`error_description` in the hash,
// or the `message` on a failed exchange). It gets no allowlist because it is
// free text by nature -- what it gets instead is a length cap and whitespace
// collapsing, and the guarantee that it is never rendered into markup: it
// travels as a query param (so `encodeURIComponent` neutralises anything that
// would matter in a URL or a Location header) and is only ever logged or shown
// as toast text.
//
// It exists because "Something went wrong signing in with Google" is the same
// sentence for a project that is rate limiting you, a redirect URL missing from
// the allow list, and a disabled provider -- three different problems with three
// different fixes, none of which the player or the developer could tell apart.
const DESCRIPTION_MAX_LENGTH = 200;

export function sanitizeErrorDescription(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // `\s` covers the CR/LF that are the only characters worth worrying about in
  // a redirect, and GoTrue descriptions arrive `+`-encoded and sometimes
  // multi-line, so collapsing is what makes them readable in one log line.
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.slice(0, DESCRIPTION_MAX_LENGTH);
}

// Falls back to DEFAULT_NEXT rather than throwing: `next` only decides where the
// user lands after signing in, and sending them to the default beats failing
// an otherwise-successful auth round trip.
export function sanitizeNextPath(raw: string | null | undefined): string {
  if (!raw || raw.length > NEXT_MAX_LENGTH) return DEFAULT_NEXT;
  if (!SAFE_NEXT_PATH.test(raw)) return DEFAULT_NEXT;
  if (raw.startsWith("//") || raw.includes("..")) return DEFAULT_NEXT;
  return raw;
}

export function sanitizeErrorCode(raw: string | null | undefined): string {
  if (!raw || !SAFE_ERROR_CODE.test(raw)) return DEFAULT_ERROR_CODE;
  return raw;
}

// Which round trip just landed. Three of them come back through
// /auth/callback and they need different words on arrival -- "Signed in with
// Google" is wrong for a confirmed email address and actively confusing on the
// password-reset page. The caller sets it on its own `redirectTo` (so it is our
// value, round-tripping through Supabase), and the route forwards it to the
// destination as `?auth=<flow>`; components/auth/OAuthErrorHandler.tsx maps it
// to copy.
//
// An allowlist, not a passthrough, for the same reason `next` is one: it is
// attacker-supplied by the time it comes back, and it decides what the app then
// tells the player happened. Unknown values become the Google flow, which is
// the only one that existed before this and the one every legacy `?oauth=
// success` link in flight means.
export const AUTH_FLOWS = ["google", "email", "recovery"] as const;
export type AuthFlow = (typeof AUTH_FLOWS)[number];

const DEFAULT_AUTH_FLOW: AuthFlow = "google";

export function sanitizeAuthFlow(raw: string | null | undefined): AuthFlow {
  return (AUTH_FLOWS as readonly string[]).includes(raw ?? "") ? (raw as AuthFlow) : DEFAULT_AUTH_FLOW;
}

export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type HashForwardHtmlInput = {
  /** Already through sanitizeNextPath. */
  next: string;
  /** Already through sanitizeErrorCode. */
  errorCode: string;
  /** Per-response CSP nonce; the served script-src allows only this. */
  nonce: string;
};

// The script body is a constant -- no request data is interpolated into it.
// It reads both values off its own `data-*` attributes via
// `document.currentScript`, which is set for the whole synchronous execution
// of a classic inline script.
//
// It also forwards `error_description` straight out of the hash. That costs
// nothing in the model above precisely because it never passes through here as
// a value: the script reads it from `window.location.hash` at runtime and
// encodes it into the URL it navigates to, so there is no interpolation site
// for it to escape from. Without it, the only thing a failed Google round trip
// ever tells anyone is a coarse code like `server_error`.
export function buildHashForwardHtml({ next, errorCode, nonce }: HashForwardHtmlInput): string {
  const safeNext = escapeHtmlAttribute(next);
  const safeErrorCode = escapeHtmlAttribute(errorCode);
  const safeNonce = escapeHtmlAttribute(nonce);

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Signing you in…</title></head>
<body>
<noscript><a href="${safeNext}">Continue</a></noscript>
<script nonce="${safeNonce}" data-next="${safeNext}" data-fallback-code="${safeErrorCode}">
(function () {
  var el = document.currentScript;
  var hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  var code = hashParams.get("error_code") || hashParams.get("error") || el.dataset.fallbackCode;
  var description = hashParams.get("error_description") || "";
  var query = "?error_code=" + encodeURIComponent(code);
  if (description) query += "&error_description=" + encodeURIComponent(description.slice(0, 200));
  window.location.replace(el.dataset.next + query);
})();
</script>
</body>
</html>`;
}
