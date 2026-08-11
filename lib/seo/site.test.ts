import { describe, expect, it } from "vitest";

import { normalizeOrigin } from "./site";

// `normalizeOrigin` decides what every canonical URL, the sitemap and the OG
// tags are rooted at. Its failure mode is silent and total: a stray trailing
// slash or a path left on the env var is prepended to ~10 URLs, and the only
// symptom is that Search Console reports canonicals nobody can fetch, weeks
// later. Pin it here rather than discovering it there.
describe("normalizeOrigin", () => {
  it("keeps a well-formed https origin", () => {
    expect(normalizeOrigin("https://driverpit.com")).toBe("https://driverpit.com");
  });

  it("drops a trailing slash", () => {
    // The likeliest shape of a hand-pasted env var, and the one that produces
    // `https://driverpit.com//daily` in every canonical on the site.
    expect(normalizeOrigin("https://driverpit.com/")).toBe("https://driverpit.com");
  });

  it("drops a path, query and hash", () => {
    expect(normalizeOrigin("https://driverpit.com/daily?x=1#y")).toBe("https://driverpit.com");
  });

  it("adds https:// to a bare hostname", () => {
    // This is the shape Vercel's own VERCEL_PROJECT_PRODUCTION_URL takes -- it
    // has no scheme at all, so the fallback branch depends on this.
    expect(normalizeOrigin("driverpit.vercel.app")).toBe("https://driverpit.vercel.app");
  });

  it("preserves an explicit http origin and its port", () => {
    expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeOrigin("  https://driverpit.com  ")).toBe("https://driverpit.com");
  });

  it.each([undefined, null, "", "   "])("returns null for %p", (value) => {
    expect(normalizeOrigin(value)).toBeNull();
  });

  it("returns null for a non-http scheme rather than trusting it", () => {
    // Returning null lets the caller fall through to the next candidate; letting
    // this pass would put `javascript:` into a <link rel="canonical"> href.
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeOrigin("ftp://driverpit.com")).toBeNull();
  });

  it("returns null for an unparseable value", () => {
    expect(normalizeOrigin("http://")).toBeNull();
  });
});
