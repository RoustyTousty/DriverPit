import { NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { describe, expect, it } from "vitest";

import { config } from "../../middleware";
import {
  applySessionRefresh,
  handleRequest,
  type MiddlewareDeps,
  type SessionRefresh,
} from "./composedMiddleware";
import { routing } from "./routing";

// The failure this file exists for is silent: replace or mis-order the two
// middlewares and every page still renders, in every locale, correctly
// translated -- and sessions stop surviving a token refresh. Nobody connects
// that to an i18n change. So the assertions below are about cookies and
// ordering, not about locales.

const ACCESS_TOKEN = "sb-driverpit-auth-token";

/** A refresh that rotates the auth cookie, as a real one does. */
function rotatingRefresh(): MiddlewareDeps["refreshSession"] {
  return async (request) => {
    request.cookies.set(ACCESS_TOKEN, "rotated");
    return {
      cookies: [{ name: ACCESS_TOKEN, value: "rotated", options: { path: "/", httpOnly: true } }],
      headers: { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" },
    };
  };
}

function requestFor(path: string, cookie = `${ACCESS_TOKEN}=expired`) {
  return new NextRequest(`https://driverpit.com${path}`, { headers: { cookie } });
}

const realRouting: MiddlewareDeps["routeLocale"] = createIntlMiddleware(routing);

describe("composed middleware", () => {
  it("carries refreshed auth cookies onto the locale response", async () => {
    const response = await handleRequest(requestFor("/es/faq"), {
      refreshSession: rotatingRefresh(),
      routeLocale: realRouting,
    });

    expect(response.cookies.get(ACCESS_TOKEN)?.value).toBe("rotated");
  });

  it("carries them onto a REDIRECT too", async () => {
    // A redirect is where dropping the cookies is fatal rather than cosmetic:
    // the rotated refresh token has already been spent server-side, so a
    // browser left holding the old one cannot refresh again. next-intl
    // redirects whenever the default locale is reached through its own prefix.
    const response = await handleRequest(requestFor("/en/faq"), {
      refreshSession: rotatingRefresh(),
      routeLocale: realRouting,
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://driverpit.com/faq");
    expect(response.cookies.get(ACCESS_TOKEN)?.value).toBe("rotated");
  });

  it("forwards the refreshed cookie to the route being rendered, not just to the browser", async () => {
    // The other half, and the one an integration test would miss because the
    // browser ends up correct either way: the Server Components rendering THIS
    // request read the forwarded request headers. If the refresh ran after the
    // rewrite, this header would still say `expired` and the page would render
    // signed-out for one request.
    const response = await handleRequest(requestFor("/es/faq"), {
      refreshSession: rotatingRefresh(),
      routeLocale: realRouting,
    });

    expect(response.headers.get("x-middleware-request-cookie")).toContain(
      `${ACCESS_TOKEN}=rotated`,
    );
  });

  it("applies the no-store headers @supabase/ssr asks for alongside auth cookies", async () => {
    const response = await handleRequest(requestFor("/es/faq"), {
      refreshSession: rotatingRefresh(),
      routeLocale: realRouting,
    });

    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("refreshes the session BEFORE routing, never after", async () => {
    // Pins the order directly rather than by consequence. Reversed, the two
    // assertions above about the forwarded request header cannot hold.
    const order: string[] = [];

    await handleRequest(requestFor("/es/faq"), {
      refreshSession: async () => {
        order.push("refresh");
        return { cookies: [], headers: {} };
      },
      routeLocale: (request) => {
        order.push("route");
        return realRouting(request);
      },
    });

    expect(order).toEqual(["refresh", "route"]);
  });

  it("still routes when there is nothing to refresh", async () => {
    const response = await handleRequest(requestFor("/", ""), {
      refreshSession: async () => ({ cookies: [], headers: {} }) satisfies SessionRefresh,
      routeLocale: realRouting,
    });

    expect(response.status).toBe(200);
    // "as-needed": the default locale is served at the bare path and rewritten
    // internally, so `/` must not become a redirect. Pass 5 removed a redirect
    // from this exact URL and it must not come back.
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("locale routing", () => {
  it("serves the default locale unprefixed, so every already-indexed URL is unchanged", () => {
    for (const path of ["/", "/faq", "/archive/2026-08-01", "/drivers/lewis-hamilton"]) {
      const response = realRouting(requestFor(path));
      expect(response.status, path).toBe(200);
      expect(response.headers.get("x-middleware-rewrite") ?? "", path).toContain("/en");
    }
  });

  it("routes a prefixed locale to the same page, with no redirect", () => {
    // `/es/faq` needs no rewrite -- the external and internal paths are already
    // the same -- so what is asserted is that it is served (not redirected) and
    // that the locale reaches the route.
    const response = realRouting(requestFor("/es/faq"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-next-intl-locale")).toBe("es");
  });

  it("serves Portuguese at /pt, covering every Portuguese market", () => {
    // Plain `pt`, not `pt-BR`: an hreflang of `pt-BR` targets Brazil ONLY, so
    // Portugal, Angola and Mozambique would fall through to x-default (English).
    // Also guards the prefix itself -- an unrecognised prefix is not a 404 under
    // "as-needed", it is just a path, so a wrong one would serve the ENGLISH
    // page at a second URL and duplicate the whole site.
    // No rewrite header, and that is the rename working: the tag and the prefix
    // are now the same string, so `/pt/faq` is already the internal path. The
    // old `pt-BR` tag had to be rewritten from `/pt-br`, which is exactly the
    // mismatch this locale no longer has.
    const response = realRouting(requestFor("/pt/faq"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-next-intl-locale")).toBe("pt");
  });

  it("does not sniff accept-language", () => {
    // localeDetection is off by design: an automatic redirect off `/` puts a
    // hop back on the most-linked URL the site has and hides locales from
    // crawlers. Discovery is hreflang plus the footer switcher.
    const request = new NextRequest("https://driverpit.com/", {
      headers: { "accept-language": "es-ES,es;q=0.9" },
    });
    const response = realRouting(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toContain("/en");
  });
});

describe("applySessionRefresh", () => {
  it("is a no-op when nothing was refreshed", () => {
    const response = applySessionRefresh(NextResponse.next(), { cookies: [], headers: {} });
    expect([...response.cookies.getAll()]).toHaveLength(0);
  });
});

// The matcher decides which requests the pair above ever sees, and getting it
// wrong is silent in both directions: too narrow and sessions stop refreshing,
// too wide and next-intl rewrites a fixed-path file into a locale that does not
// serve it. The second one actually happened -- /sitemap.xml, /robots.txt and
// /manifest.webmanifest all 404'd, every page still rendered, and the only
// symptom would have been Search Console reporting a missing sitemap.
describe("middleware matcher", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it("skips the fixed-path metadata files a crawler asks for by name", () => {
    // These have no locale variant by specification. A crawler asks for
    // "/robots.txt"; there is no such thing as "/en/robots.txt".
    for (const path of ["/sitemap.xml", "/robots.txt", "/manifest.webmanifest"]) {
      expect(matcher.test(path), path).toBe(false);
    }
  });

  it("skips the route handlers and the OAuth return URL", () => {
    for (const path of ["/api/recap/2026-08-07/image", "/auth/callback"]) {
      expect(matcher.test(path), path).toBe(false);
    }
  });

  it("still covers the real pages, in every locale", () => {
    // The other direction: these are the requests that must keep getting a
    // session refresh, or players get signed out at random.
    for (const path of ["/", "/faq", "/es", "/pt/archive", "/de/drivers/lewis-hamilton"]) {
      expect(matcher.test(path), path).toBe(true);
    }
  });
});
