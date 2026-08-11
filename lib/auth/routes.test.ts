import { describe, expect, it } from "vitest";

import { DEFAULT_NEXT, sanitizeNextPath } from "./oauthCallback";
import { RESET_PASSWORD_PATH, SIGN_IN_PATH, signInHref } from "./routes";

// signInHref and sanitizeNextPath are two halves of one round trip: every guest
// upgrade prompt on the site builds a link with the first, and /auth/sign-in
// reads it back with the second (and then hands it to Supabase as part of a
// `redirectTo`). What matters is that a path survives that trip unchanged --
// otherwise a nudge from /online silently returns the player to the daily
// board, and the symptom is one nobody would connect to an encoding rule.

describe("signInHref", () => {
  it("is the bare path when there is nowhere in particular to return to", () => {
    expect(signInHref()).toBe(SIGN_IN_PATH);
    expect(signInHref(null)).toBe(SIGN_IN_PATH);
  });

  it("round-trips every destination the app actually links from", () => {
    for (const next of ["/", "/infinite", "/online", RESET_PASSWORD_PATH]) {
      const href = signInHref(next);
      const search = new URLSearchParams(href.slice(href.indexOf("?")));
      expect(sanitizeNextPath(search.get("next"))).toBe(next);
    }
  });

  it("encodes, so the destination cannot smuggle its own parameters", () => {
    // A `next` is not a query string. Escaped here and, on the far side,
    // rejected outright by sanitizeNextPath rather than followed.
    const href = signInHref("/infinite?foo=bar");
    expect(href).not.toContain("&");
    expect(href).toContain("%3F");

    const search = new URLSearchParams(href.slice(href.indexOf("?")));
    expect(sanitizeNextPath(search.get("next"))).toBe(DEFAULT_NEXT);
  });
});
