// Reads the DEPLOYED site back and checks that Pass 0's tags actually say what
// they are supposed to say (docs/seo-roadmap.md, Pass 1):
//
//   SEO_AUDIT_URL=https://driverpit.com npm run seo:audit
//
// Nothing in Pass 0 fails loudly when it is wrong. A bad NEXT_PUBLIC_SITE_URL,
// a page that bypassed buildPageMetadata, a sitemap entry that 308s, an OG route
// that 500s in production because its font was never traced -- every one of those
// renders a page that looks fine and is silently unindexable or unshareable. The
// only way to know is to fetch it and read it, which is this.
//
// The rules live in ./seoAuditChecks.ts (pure, unit-tested). This file is the
// I/O: which URLs to fetch, in what order, and the exit code. Same split as
// generateFlagSubset.ts / flagSubset.ts.
//
// NOT wired into ci.yml, deliberately: it needs a deployed origin, and a job
// that goes red because a deploy is in flight is a job people learn to ignore.
// Run it after a deploy, and after any change to NEXT_PUBLIC_SITE_URL.

import "dotenv/config";

import { LOCALES, localePath } from "../lib/i18n/locales";

import {
  checkAuthPageCrawlable,
  checkLegacyRedirect,
  checkNoIndex,
  checkOgImageResponse,
  checkOgTitlesUnique,
  checkPageTags,
  checkRobotsTxt,
  checkSitemap,
  checkTitlesUnique,
  parsePageTags,
  parseSitemapUrls,
  resolveAuditOrigin,
  SITE_URL_ENV_VAR,
  TARGET_ENV_VAR,
  type AuditedPage,
  type Finding,
} from "./seoAuditChecks";

// The auth page whose noindex and crawlability are checked. /auth/reset-password
// is the same layout and the same directive; sign-in is the one with inbound
// links, so it is the one that would actually get indexed if this broke.
const AUTH_PATH = "/auth/sign-in";

/**
 * Retired URLs, and where each must land. Checked in EVERY locale, because the
 * way this breaks is per-locale: `/es/daily` landing on the English home page
 * is a redirect that un-translates the site, and it looks fine from `/daily`.
 */
const LEGACY_REDIRECTS = LOCALES.map((locale) => ({
  path: localePath(locale, "/daily"),
  expected: localePath(locale, "/"),
}));

const REQUEST_TIMEOUT_MS = 20_000;

const USER_AGENT = "DriverPit-seo-audit (+https://github.com/RoustyTousty/DriverScrabble)";

interface FetchedDocument {
  status: number;
  contentType: string | null;
  /** Where a 3xx pointed, so the failure can name the redirect target. */
  location: string | null;
  body: string;
}

/**
 * `redirect: "manual"` is the load-bearing option. Following redirects would
 * make a sitemap full of 308s look like a sitemap full of 200s -- which is the
 * common, invisible own-goal this script exists to catch -- and would compare
 * each canonical against the URL that ANSWERED rather than the URL that was
 * listed.
 */
async function fetchDocument(url: string): Promise<FetchedDocument> {
  const response = await fetch(url, {
    redirect: "manual",
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    location: response.headers.get("location"),
    // Read the body even on a non-200 so nothing is left dangling on the socket.
    body: await response.text(),
  };
}

function describeStatus(document: FetchedDocument): string {
  return document.location ? `${document.status} → ${document.location}` : `${document.status}`;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const report = { passed: 0, failed: 0 };

function emit(findings: readonly Finding[], indent = "  "): void {
  for (const finding of findings) {
    if (finding.ok) {
      report.passed += 1;
      console.log(`${indent}ok    ${finding.check}: ${finding.message}`);
    } else {
      report.failed += 1;
      console.error(`${indent}FAIL  ${finding.check}: ${finding.message}`);
    }
  }
}

/**
 * A page that is entirely correct prints one line; only its failures are
 * expanded. Nine pages × six checks is 54 lines of noise otherwise, and an
 * audit nobody reads to the end is an audit that finds nothing.
 */
function emitPage(url: string, origin: string, findings: readonly Finding[]): void {
  const failures = findings.filter((finding) => !finding.ok);
  const path = url.slice(origin.length) || "/";
  if (failures.length === 0) {
    report.passed += findings.length;
    console.log(`  ok    ${path.padEnd(20)} ${findings.length} checks`);
    return;
  }
  console.error(`  FAIL  ${path}`);
  emit(failures, "        ");
  report.passed += findings.length - failures.length;
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const origin = resolveAuditOrigin(process.env[TARGET_ENV_VAR], process.env[SITE_URL_ENV_VAR]);
  console.log(`SEO audit of ${origin}`);
  console.log(`  (from ${process.env[TARGET_ENV_VAR] ? TARGET_ENV_VAR : SITE_URL_ENV_VAR})`);

  // -- robots.txt -----------------------------------------------------------
  section("robots.txt");
  const robots = await fetchDocument(`${origin}/robots.txt`);
  if (robots.status !== 200) {
    emit([
      {
        ok: false,
        check: "reachable",
        message:
          `${origin}/robots.txt returned ${describeStatus(robots)}. ` +
          (robots.location
            ? `An origin that redirects is not the origin to audit -- point ${TARGET_ENV_VAR} ` +
              `at the canonical one.`
            : `app/robots.ts should serve it; a 404 means the route is not being generated.`),
      },
    ]);
    // Everything below reads robots.txt or assumes this origin serves the site.
    return finish();
  }
  emit([{ ok: true, check: "reachable", message: "200" }]);
  emit(checkRobotsTxt(robots.body, origin));

  // -- sitemap.xml ----------------------------------------------------------
  section("sitemap.xml");
  const sitemap = await fetchDocument(`${origin}/sitemap.xml`);
  if (sitemap.status !== 200) {
    emit([
      {
        ok: false,
        check: "reachable",
        message: `${origin}/sitemap.xml returned ${describeStatus(sitemap)}. See app/sitemap.ts.`,
      },
    ]);
    return finish();
  }
  emit([{ ok: true, check: "reachable", message: "200" }]);

  const sitemapUrls = parseSitemapUrls(sitemap.body);
  const sitemapFindings = checkSitemap(sitemapUrls, origin);
  emit(sitemapFindings);
  if (sitemapFindings.some((finding) => !finding.ok && finding.check === "sitemap origin")) {
    // Stop rather than emit the same root cause once per page per tag. Every
    // canonical, every og:image and every fetch below would fail for this one
    // reason, and forty red lines hide the one that matters.
    console.error("\nStopping: every check below would fail for the same reason.");
    return finish();
  }

  // -- every page in the sitemap -------------------------------------------
  section(`Pages (${sitemapUrls.length} from the sitemap)`);
  const pages: AuditedPage[] = [];
  for (const url of sitemapUrls) {
    const document = await fetchDocument(url);
    if (document.status !== 200) {
      emitPage(url, origin, [
        {
          ok: false,
          check: "status",
          message:
            `${describeStatus(document)}, expected 200. A sitemap must list final URLs: a ` +
            `crawler treats a listed redirect as a mistake about the site's own structure, ` +
            `and a listed 404 as a sitemap that cannot be trusted.`,
        },
      ]);
      continue;
    }
    const tags = parsePageTags(document.body);
    const page: AuditedPage = { url, tags };
    pages.push(page);
    emitPage(url, origin, checkPageTags(page, origin));
  }

  // -- cross-page -----------------------------------------------------------
  section("Across pages");
  emit(checkTitlesUnique(pages));
  emit(checkOgTitlesUnique(pages));

  // -- the OG image ---------------------------------------------------------
  section("OG image");
  const ogImages = [
    ...new Set(
      pages
        .map((page) => page.tags.meta.get("og:image")?.[0])
        .filter((url): url is string => url !== undefined),
    ),
  ];
  if (ogImages.length === 0) {
    emit([{ ok: false, check: "og:image fetch", message: "No page declared an og:image to fetch." }]);
  }
  for (const url of ogImages) {
    const image = await fetchDocument(url);
    emit(checkOgImageResponse(url, image.status, image.contentType));
  }

  // -- retired URLs ---------------------------------------------------------
  // After the page checks, because a sitemap listing one of these is the louder
  // failure and `checkSitemap` reports it first.
  section("Legacy redirects");
  for (const { path, expected } of LEGACY_REDIRECTS) {
    const document = await fetchDocument(`${origin}${path}`);
    emit(checkLegacyRedirect(path, expected, document.status, document.location, origin));
  }

  // -- /auth/sign-in --------------------------------------------------------
  section(AUTH_PATH);
  const authUrl = `${origin}${AUTH_PATH}`;
  const authPage = await fetchDocument(authUrl);
  if (authPage.status !== 200) {
    emit([
      {
        ok: false,
        check: "status",
        message: `${describeStatus(authPage)}, expected 200. It must stay reachable: it is ` +
          `linked from six places and noindex only works on a page that can be fetched.`,
      },
    ]);
  } else {
    emit(checkNoIndex(parsePageTags(authPage.body), AUTH_PATH));
    emit(checkAuthPageCrawlable(robots.body, AUTH_PATH));
  }

  return finish();
}

function finish(): void {
  console.log(`\n${report.passed} passed, ${report.failed} failed.`);
  if (report.failed > 0) {
    process.exitCode = 1;
    return;
  }
  console.log("SEO audit passed.");
}

main().catch((error: unknown) => {
  // A thrown error is a failure of the audit, not a caveat on it: an unreachable
  // origin or an unset env var must exit non-zero, or wiring this into anything
  // later would silently pass.
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
