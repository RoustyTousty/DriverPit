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

const DEFAULT_NEXT = "/daily";
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

// Falls back to `/daily` rather than throwing: `next` only decides where the
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
  window.location.replace(el.dataset.next + "?error_code=" + encodeURIComponent(code));
})();
</script>
</body>
</html>`;
}
