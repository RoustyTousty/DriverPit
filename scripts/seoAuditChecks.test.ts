import { describe, expect, it } from "vitest";

import {
  checkAuthPageCrawlable,
  checkJsonLd,
  checkLegacyRedirect,
  checkNoIndex,
  checkOgImageResponse,
  checkOgTitlesUnique,
  checkPageTags,
  checkRobotsTxt,
  checkSitemap,
  checkTitlesUnique,
  isPathAllowed,
  parsePageTags,
  parseRobotsTxt,
  parseSitemapUrls,
  resolveAuditOrigin,
  rulesForUserAgent,
  type AuditedPage,
  type Finding,
} from "./seoAuditChecks";

// The audit is the only thing that will ever notice a wrong canonical or a
// bypassed metadata builder, so its own rules need pinning: a check that has
// silently stopped checking is worse than no check, because it reports green.
//
// Everything here is offline. The fetching lives in seoAudit.ts.

const ORIGIN = "https://driverpit.com";

function failures(findings: readonly Finding[]): string[] {
  return findings.filter((finding) => !finding.ok).map((finding) => finding.check);
}

function messageFor(findings: readonly Finding[], check: string): string {
  const finding = findings.find((entry) => entry.check === check);
  if (!finding) throw new Error(`No finding for "${check}"`);
  return finding.message;
}

// The shape Next actually emits, down to the self-closing tags and the
// attribute order -- a hand-idealised fixture would pass against a parser that
// cannot read the real thing.
function pageHtml(overrides: Partial<Record<string, string>> = {}): string {
  const values = {
    title: "How to play – DriverPit",
    canonical: `${ORIGIN}/how-to-play`,
    ogTitle: "How to play – DriverPit",
    ogDescription: "How the five attribute columns work.",
    ogImage: `${ORIGIN}/opengraph-image?d0a1b2`,
    ...overrides,
  };
  return `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/>
<title>${values.title}</title>
<meta name="description" content="${values.ogDescription}"/>
<link rel="canonical" href="${values.canonical}"/>
<meta property="og:title" content="${values.ogTitle}"/>
<meta property="og:description" content="${values.ogDescription}"/>
<meta property="og:image" content="${values.ogImage}"/>
<meta name="twitter:card" content="summary_large_image"/>
</head><body>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"DriverPit"}</script>
</body></html>`;
}

describe("resolveAuditOrigin", () => {
  it("prefers SEO_AUDIT_URL over NEXT_PUBLIC_SITE_URL", () => {
    expect(resolveAuditOrigin("https://staging.driverpit.com", ORIGIN)).toBe(
      "https://staging.driverpit.com",
    );
  });

  it("falls back to NEXT_PUBLIC_SITE_URL and normalizes it", () => {
    expect(resolveAuditOrigin(undefined, "https://driverpit.com/")).toBe(ORIGIN);
  });

  // The one that matters. lib/seo/site.ts falls back to localhost so a dev
  // build renders; inheriting that here would audit localhost and report green
  // about a site nobody asked about.
  it("refuses to guess when neither is set", () => {
    expect(() => resolveAuditOrigin(undefined, undefined)).toThrow(/No origin to audit/);
    expect(() => resolveAuditOrigin("", "  ")).toThrow(/No origin to audit/);
  });

  it("throws rather than fall through when a value is set but unparseable", () => {
    // Falling back would audit the wrong site while the operator believes they
    // named one, which is worse than stopping.
    expect(() => resolveAuditOrigin("javascript:alert(1)", undefined)).toThrow(/does not parse|parses/);
  });
});

describe("robots.txt", () => {
  // What app/robots.ts emits today.
  const ROBOTS = [
    "User-Agent: *",
    "Allow: /",
    "Disallow: /api/",
    "",
    `Host: ${ORIGIN}`,
    `Sitemap: ${ORIGIN}/sitemap.xml`,
  ].join("\n");

  it("reads the sitemap line and the rules", () => {
    const parsed = parseRobotsTxt(ROBOTS);
    expect(parsed.sitemaps).toEqual([`${ORIGIN}/sitemap.xml`]);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0].agents).toEqual(["*"]);
  });

  it("ignores comments and an empty Disallow", () => {
    // `Disallow:` with no value is the REP's allow-all. Treating it as a rule
    // matching every path would report the whole site as blocked.
    const parsed = parseRobotsTxt("# hello\nUser-agent: *\nDisallow:\n");
    expect(parsed.groups[0].rules).toEqual([]);
    expect(isPathAllowed(parsed.groups[0].rules, "/daily")).toBe(true);
  });

  it("applies longest-match-wins rather than any-disallow-blocks", () => {
    const rules = rulesForUserAgent(parseRobotsTxt(ROBOTS), "*");
    // A naive implementation reads `Disallow: /api/` as blocking nothing (no
    // prefix match on "/") or reads any disallow as blocking everything. Both
    // get one of these two wrong.
    expect(isPathAllowed(rules, "/")).toBe(true);
    expect(isPathAllowed(rules, "/daily")).toBe(true);
    expect(isPathAllowed(rules, "/api/recap")).toBe(false);
  });

  it("honours wildcards and the end anchor", () => {
    const rules = rulesForUserAgent(parseRobotsTxt("User-agent: *\nDisallow: /*.json$\n"), "*");
    expect(isPathAllowed(rules, "/data.json")).toBe(false);
    expect(isPathAllowed(rules, "/data.json.html")).toBe(true);
  });

  it("gives an agent its own group in preference to *", () => {
    const parsed = parseRobotsTxt("User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n");
    expect(isPathAllowed(rulesForUserAgent(parsed, "Googlebot"), "/daily")).toBe(true);
    expect(isPathAllowed(rulesForUserAgent(parsed, "*"), "/daily")).toBe(false);
  });

  it("passes the real robots.txt", () => {
    expect(failures(checkRobotsTxt(ROBOTS, ORIGIN))).toEqual([]);
  });

  it("fails when the Sitemap line names another origin", () => {
    // The NEXT_PUBLIC_SITE_URL failure, seen from robots.txt: the file is
    // internally fine and points crawlers at a different deployment.
    const wrong = ROBOTS.replace(`Sitemap: ${ORIGIN}`, "Sitemap: https://driverpit.vercel.app");
    expect(failures(checkRobotsTxt(wrong, ORIGIN))).toContain("sitemap declared");
    expect(messageFor(checkRobotsTxt(wrong, ORIGIN), "sitemap declared")).toContain(
      "NEXT_PUBLIC_SITE_URL",
    );
  });

  it("fails when the site is disallowed outright", () => {
    expect(failures(checkRobotsTxt("User-agent: *\nDisallow: /\n", ORIGIN))).toContain("crawlable");
  });

  it("fails when /auth/sign-in is blocked, because that cancels its noindex", () => {
    const blocked = "User-agent: *\nAllow: /\nDisallow: /auth/\n";
    expect(failures(checkAuthPageCrawlable(blocked, "/auth/sign-in"))).toEqual(["crawlable"]);
    expect(failures(checkAuthPageCrawlable(ROBOTS, "/auth/sign-in"))).toEqual([]);
  });
});

describe("sitemap", () => {
  const XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${ORIGIN}/daily</loc><lastmod>2026-08-07T00:00:00.000Z</lastmod></url>
<url><loc>${ORIGIN}/infinite</loc></url>
</urlset>`;

  it("reads every <loc>", () => {
    expect(parseSitemapUrls(XML)).toEqual([`${ORIGIN}/daily`, `${ORIGIN}/infinite`]);
  });

  it("decodes entities in a <loc>", () => {
    expect(parseSitemapUrls("<loc>https://x.com/a?b=1&amp;c=2</loc>")).toEqual([
      "https://x.com/a?b=1&c=2",
    ]);
  });

  it("fails when the sitemap is empty or is not a sitemap", () => {
    // A 200 serving the app shell instead of XML looks exactly like this.
    expect(failures(checkSitemap(parseSitemapUrls("<html><body>hi</body></html>"), ORIGIN))).toEqual([
      "sitemap parses",
    ]);
  });

  // THE check. Without it the audit passes green against a deployment whose
  // NEXT_PUBLIC_SITE_URL is wrong, because such a deployment is perfectly
  // self-consistent: its sitemap lists vercel.app URLs and those URLs serve
  // canonicals that agree with them.
  it("fails when the sitemap is on a different origin than the one being audited", () => {
    const urls = ["https://driverpit.vercel.app/daily", "https://driverpit.vercel.app/infinite"];
    const findings = checkSitemap(urls, ORIGIN);
    expect(failures(findings)).toContain("sitemap origin");
    expect(messageFor(findings, "sitemap origin")).toContain("NEXT_PUBLIC_SITE_URL");
  });

  it("fails on duplicate entries", () => {
    expect(failures(checkSitemap([`${ORIGIN}/daily`, `${ORIGIN}/daily`], ORIGIN))).toContain(
      "sitemap unique",
    );
  });
});

describe("parsePageTags", () => {
  it("reads the title, canonical, og tags and JSON-LD out of real Next output", () => {
    const tags = parsePageTags(pageHtml());
    expect(tags.title).toBe("How to play – DriverPit");
    expect(tags.canonical).toBe(`${ORIGIN}/how-to-play`);
    expect(tags.meta.get("og:title")).toEqual(["How to play – DriverPit"]);
    expect(tags.meta.get("og:image")).toEqual([`${ORIGIN}/opengraph-image?d0a1b2`]);
    expect(tags.jsonLd).toHaveLength(1);
  });

  it("decodes escaped attribute values", () => {
    // React escapes `&` in attributes, so an og:image with a query would arrive
    // as `?a=1&amp;b=2` and be fetched literally -- a 404 reported as a broken
    // card rather than as a parser bug.
    const tags = parsePageTags(pageHtml({ ogImage: `${ORIGIN}/og?a=1&amp;b=2` }));
    expect(tags.meta.get("og:image")).toEqual([`${ORIGIN}/og?a=1&b=2`]);
  });

  it("ignores a <title> inside an inline SVG", () => {
    // An SVG's <title> is its accessible name, and it appears before the
    // streamed metadata block. Reading it would report a PASS on the wrong
    // string, which is worse than reporting nothing.
    const html = pageHtml().replace("<body>", '<body><svg><title>cup icon</title></svg>');
    expect(parsePageTags(html).title).toBe("How to play – DriverPit");
  });

  // THE parser regression. Next 15 streams metadata: for anything that is not
  // in its `htmlLimitedBots` list, the whole block lands in the body, ~30KB
  // past </head>. A parser that reads <head> only reported every page on this
  // site as having no title, no canonical and no og tags -- measured
  // 2026-08-07 against `next dev`.
  it("reads metadata that Next streamed into the body, not the head", () => {
    const streamed = pageHtml()
      .replace(/<title>[\s\S]*?<\/title>|<link rel="canonical"[^>]*>|<meta property="og:[^>]*>/g, "")
      .replace(
        "<body>",
        `<body><div>page content</div>
<title>How to play – DriverPit</title>
<link rel="canonical" href="${ORIGIN}/how-to-play"/>
<meta property="og:title" content="How to play – DriverPit"/>
<meta property="og:description" content="How the five attribute columns work."/>
<meta property="og:image" content="${ORIGIN}/opengraph-image"/>`,
      );
    const tags = parsePageTags(streamed);
    expect(tags.title).toBe("How to play – DriverPit");
    expect(tags.canonical).toBe(`${ORIGIN}/how-to-play`);
    expect(tags.meta.get("og:image")).toEqual([`${ORIGIN}/opengraph-image`]);
  });
});

describe("checkPageTags", () => {
  function page(html: string, url = `${ORIGIN}/how-to-play`): AuditedPage {
    return { url, tags: parsePageTags(html) };
  }

  it("passes a correct page", () => {
    expect(failures(checkPageTags(page(pageHtml()), ORIGIN))).toEqual([]);
  });

  it("fails when the canonical points somewhere other than the URL that served it", () => {
    const findings = checkPageTags(page(pageHtml({ canonical: `${ORIGIN}/faq` })), ORIGIN);
    expect(failures(findings)).toContain("canonical");
  });

  it("fails a relative canonical", () => {
    expect(failures(checkPageTags(page(pageHtml({ canonical: "/how-to-play" })), ORIGIN))).toContain(
      "canonical",
    );
  });

  it("fails a missing canonical", () => {
    const html = pageHtml().replace(/<link rel="canonical"[^>]*>/, "");
    expect(failures(checkPageTags(page(html), ORIGIN))).toContain("canonical");
  });

  it("fails a bare site name as the title", () => {
    expect(failures(checkPageTags(page(pageHtml({ title: "DriverPit" })), ORIGIN))).toContain("title");
  });

  it("fails a missing og:description", () => {
    const html = pageHtml().replace(/<meta property="og:description"[^>]*>/, "");
    expect(failures(checkPageTags(page(html), ORIGIN))).toContain("og:description");
  });

  it("fails an og:image on another origin", () => {
    const findings = checkPageTags(
      page(pageHtml({ ogImage: "https://driverpit.vercel.app/opengraph-image" })),
      ORIGIN,
    );
    expect(failures(findings)).toContain("og:image origin");
  });
});

describe("cross-page uniqueness", () => {
  function pageWith(path: string, title: string, ogTitle: string): AuditedPage {
    const url = `${ORIGIN}${path}`;
    return { url, tags: parsePageTags(pageHtml({ title, ogTitle, canonical: url })) };
  }

  it("passes distinct titles", () => {
    const pages = [pageWith("/faq", "FAQ – DriverPit", "FAQ – DriverPit"), pageWith("/about", "About – DriverPit", "About – DriverPit")];
    expect(failures(checkTitlesUnique(pages))).toEqual([]);
    expect(failures(checkOgTitlesUnique(pages))).toEqual([]);
  });

  it("fails two pages sharing a <title>", () => {
    const pages = [pageWith("/faq", "DriverPit", "a"), pageWith("/about", "DriverPit", "b")];
    expect(failures(checkTitlesUnique(pages))).toContain("titles unique");
  });

  // The buildPageMetadata bypass, in its exact signature: `title.template`
  // applies to `title` but not to `openGraph.title`, so a page that sets its
  // own title keeps a correct tab and inherits the ROOT's OG headline. Distinct
  // <title>s + duplicate og:titles is the only way that shows up.
  it("fails duplicate og:titles even when the <title>s are distinct", () => {
    const pages = [
      pageWith("/faq", "FAQ – DriverPit", "DriverPit — Daily Formula 1 Driver Guessing Game"),
      pageWith("/about", "About – DriverPit", "DriverPit — Daily Formula 1 Driver Guessing Game"),
    ];
    expect(failures(checkTitlesUnique(pages))).toEqual([]);
    expect(failures(checkOgTitlesUnique(pages))).toContain("og:titles unique");
  });
});

describe("checkNoIndex", () => {
  it("accepts the directive Next emits", () => {
    const html = pageHtml().replace(
      "</head>",
      '<meta name="robots" content="noindex, follow"/></head>',
    );
    expect(failures(checkNoIndex(parsePageTags(html), "/auth/sign-in"))).toEqual([]);
  });

  it("fails a page with no robots directive at all", () => {
    expect(failures(checkNoIndex(parsePageTags(pageHtml()), "/auth/sign-in"))).toEqual(["noindex"]);
  });

  it("is not fooled by `index` appearing inside another token", () => {
    const html = pageHtml().replace("</head>", '<meta name="robots" content="index, follow"/></head>');
    expect(failures(checkNoIndex(parsePageTags(html), "/auth/sign-in"))).toEqual(["noindex"]);
  });
});

describe("checkJsonLd", () => {
  it("passes a valid block", () => {
    expect(failures(checkJsonLd(parsePageTags(pageHtml())))).toEqual([]);
  });

  it("fails a block that is not valid JSON", () => {
    const html = pageHtml().replace('"@type":"WebSite"', '"@type":WebSite');
    expect(failures(checkJsonLd(parsePageTags(html)))).toEqual(["json-ld"]);
  });

  it("fails a block missing @context or @type", () => {
    const html = pageHtml().replace('"@context":"https://schema.org",', "");
    expect(failures(checkJsonLd(parsePageTags(html)))).toEqual(["json-ld"]);
  });

  it("checks each member of an array of entities", () => {
    const html = pageHtml().replace(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
      '<script type="application/ld+json">[{"@context":"https://schema.org","@type":"WebSite"},{"name":"x"}]</script>',
    );
    expect(failures(checkJsonLd(parsePageTags(html)))).toEqual(["json-ld"]);
  });
});

describe("checkOgImageResponse", () => {
  const URL_ = `${ORIGIN}/opengraph-image?d0a1b2`;

  it("passes 200 image/png", () => {
    expect(failures(checkOgImageResponse(URL_, 200, "image/png"))).toEqual([]);
  });

  it("tolerates a charset parameter", () => {
    expect(failures(checkOgImageResponse(URL_, 200, "image/png; charset=utf-8"))).toEqual([]);
  });

  it("fails a 500 and names the tracing cause", () => {
    // The one that only ever happens in production: next/og reads its fonts at
    // runtime, and an untraced path renders locally and 500s on Vercel.
    expect(messageFor(checkOgImageResponse(URL_, 500, null), "og:image fetch")).toContain(
      "outputFileTracingIncludes",
    );
  });

  it("fails a 200 that is not a PNG", () => {
    expect(failures(checkOgImageResponse(URL_, 200, "text/html; charset=utf-8"))).toEqual([
      "og:image fetch",
    ]);
  });
});

describe("checkLegacyRedirect", () => {
  it("passes a 308 to the expected path", () => {
    expect(failures(checkLegacyRedirect("/daily", "/", 308, "/", ORIGIN))).toEqual([]);
  });

  it("accepts an absolute Location on the same origin", () => {
    expect(
      failures(checkLegacyRedirect("/daily", "/", 308, `${ORIGIN}/`, ORIGIN)),
    ).toEqual([]);
  });

  it("fails a 200 and names the streaming-layout cause", () => {
    // THE REGRESSION THIS EXISTS FOR, and the reason it is a separate branch
    // from "unexpected status": `permanentRedirect()` in a page under the
    // (game) layout could not set a status once the shell had streamed, so
    // Next served /'s content at /daily inside a 200 with a meta-refresh and
    // no canonical. Google reported it as a duplicate. A 404 here would have
    // been noticed in a day; a 200 looked entirely healthy.
    const found = checkLegacyRedirect("/daily", "/", 200, null, ORIGIN);
    expect(failures(found)).toEqual(["redirect /daily"]);
    expect(messageFor(found, "redirect /daily")).toContain("meta-refresh");
  });

  it("fails a 404 — the URL is still linked and must resolve", () => {
    expect(failures(checkLegacyRedirect("/daily", "/", 404, null, ORIGIN))).toEqual([
      "redirect /daily",
    ]);
  });

  it("fails a redirect that drops the locale prefix", () => {
    // /es/daily -> / would silently serve English to everyone following an old
    // Spanish link, which is precisely the traffic the redirect is preserving.
    const found = checkLegacyRedirect("/es/daily", "/es", 308, "/", ORIGIN);
    expect(failures(found)).toEqual(["redirect /es/daily"]);
    expect(messageFor(found, "redirect /es/daily")).toContain("locale");
  });

  it("fails a 307, which tells a crawler the move may be undone", () => {
    expect(failures(checkLegacyRedirect("/daily", "/", 307, "/", ORIGIN))).toEqual([
      "redirect /daily",
    ]);
  });
});
