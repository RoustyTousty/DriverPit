// The pure half of `npm run seo:audit` (docs/seo-roadmap.md, Pass 1).
//
// Pass 0 shipped canonicals, a sitemap, robots.txt, OG tags and JSON-LD across
// nine pages, and every one of them is rooted at ONE value -- the origin
// lib/seo/site.ts resolves. A wrong value there produces no error whatsoever:
// the pages render, the tags are simply wrong, and the symptom surfaces in
// Search Console weeks later as canonicals nobody can fetch, or never. So the
// deployed HTML has to be read back and checked against what it should say.
//
// Everything here is pure -- parsing and assertions over strings -- so
// seoAuditChecks.test.ts can exercise the rules in the static CI tier without a
// deployment. The fetching, ordering and exit code live in seoAudit.ts. Same
// split as flagSubset.ts / generateFlagSubset.ts and releaseGuards.ts / seed.ts.
//
// The sharpest check in the file is the least obvious one: every URL the
// deployment declares about itself -- sitemap <loc>, <link rel="canonical">,
// og:image -- must be on the origin being audited. Without it the whole audit
// passes green against a misconfigured site, because a deployment with the
// wrong NEXT_PUBLIC_SITE_URL is perfectly self-consistent: its sitemap lists
// vercel.app URLs, those URLs serve pages whose canonicals also say vercel.app,
// and every "canonical equals the URL that served it" check agrees. Comparing
// against the origin the OPERATOR named is the only thing that can tell the two
// apart.

import { SITE_NAME, normalizeOrigin } from "../lib/seo/site";

export const TARGET_ENV_VAR = "SEO_AUDIT_URL";
export const SITE_URL_ENV_VAR = "NEXT_PUBLIC_SITE_URL";

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export interface Finding {
  ok: boolean;
  /** Short label, used to group the output. */
  check: string;
  /**
   * On a failure this is the whole bug report: what was expected, what was
   * found, and which knob fixes it. "canonical mismatch" on its own sends the
   * reader back to a codebase they may not know.
   */
  message: string;
}

export function pass(check: string, message: string): Finding {
  return { ok: true, check, message };
}

export function fail(check: string, message: string): Finding {
  return { ok: false, check, message };
}

// ---------------------------------------------------------------------------
// Which origin is under audit
// ---------------------------------------------------------------------------

/**
 * Resolves the origin to audit from the two env vars, and **refuses to guess**.
 *
 * `lib/seo/site.ts` deliberately falls back to localhost so a dev build renders;
 * that fallback is exactly wrong here. An audit that silently retargets itself
 * at localhost:3000 -- or at a preview domain -- reports green about a site
 * nobody asked about, which is the same class of silent-wrong-answer this whole
 * script exists to catch. So no fallback, and no `process.argv`: PowerShell
 * strips a bare `--`, so a flag-supplied target would arrive as undefined and
 * land straight back in the guessing branch (see docs/seo-roadmap.md, "Local
 * environment quirks").
 */
export function resolveAuditOrigin(
  rawTarget: string | undefined,
  rawSiteUrl: string | undefined,
): string {
  const origin = normalizeOrigin(rawTarget) ?? normalizeOrigin(rawSiteUrl);
  if (origin) return origin;

  const supplied = [rawTarget, rawSiteUrl].some((value) => value !== undefined && value.trim() !== "");
  throw new Error(
    supplied
      ? `Neither ${TARGET_ENV_VAR} nor ${SITE_URL_ENV_VAR} parses as an http(s) origin. ` +
        `Got ${TARGET_ENV_VAR}=${JSON.stringify(rawTarget)}, ` +
        `${SITE_URL_ENV_VAR}=${JSON.stringify(rawSiteUrl)}.`
      : `No origin to audit. Set ${TARGET_ENV_VAR} (or ${SITE_URL_ENV_VAR}) to the ` +
        `site's public origin, e.g. ${TARGET_ENV_VAR}=https://driverpit.com. There is ` +
        `deliberately no default: auditing localhost by accident reports green about ` +
        `the wrong site.`,
  );
}

/** True when `url` is absolute, parseable and rooted at `origin`. */
export function isOnOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

export interface RobotsRule {
  allow: boolean;
  path: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

export interface RobotsTxt {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export function parseRobotsTxt(text: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  // A blank line does NOT end a group in the REP, but a User-agent line that
  // follows a rule line does start a new one. Tracked rather than assumed, so
  // consecutive `User-agent:` lines accumulate into one group as they should.
  let lastWasRule = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (line === "") continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "sitemap") {
      sitemaps.push(value);
      continue;
    }

    if (field === "user-agent") {
      if (!current || lastWasRule) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasRule = false;
      continue;
    }

    if (field === "allow" || field === "disallow") {
      if (!current) continue;
      // An empty `Disallow:` means "nothing is disallowed" -- it is the REP's
      // way of spelling allow-all, not a rule matching every path. Dropping it
      // is what keeps `Disallow:` from reading as `Disallow: /`.
      if (value !== "") current.rules.push({ allow: field === "allow", path: value });
      lastWasRule = true;
    }
  }

  return { groups, sitemaps };
}

/** The rules that apply to `agent`, falling back to the `*` group. */
export function rulesForUserAgent(robots: RobotsTxt, agent: string): RobotsRule[] {
  const wanted = agent.toLowerCase();
  const exact = robots.groups.find((group) => group.agents.includes(wanted));
  if (exact) return exact.rules;
  const wildcard = robots.groups.find((group) => group.agents.includes("*"));
  return wildcard ? wildcard.rules : [];
}

/**
 * Specificity of a match, or null for no match. `*` matches any run of
 * characters and a trailing `$` anchors to the end of the path -- both are in
 * the spec and both are cheap; leaving them out would make this quietly
 * disagree with a real crawler the first time someone writes `Disallow: /*?`.
 */
function matchLength(pattern: string, path: string): number | null {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const regex = new RegExp(`^${source}${anchored ? "$" : ""}`);
  return regex.test(path) ? pattern.length : null;
}

/**
 * The REP's own precedence rule: the longest matching pattern wins, and a tie
 * goes to Allow. A naive "any Disallow matches ⇒ blocked" would report
 * `Allow: /` + `Disallow: /api/` as blocking every path on the site.
 */
export function isPathAllowed(rules: readonly RobotsRule[], path: string): boolean {
  let bestLength = -1;
  let allowed = true;

  for (const rule of rules) {
    const length = matchLength(rule.path, path);
    if (length === null) continue;
    if (length > bestLength || (length === bestLength && rule.allow)) {
      bestLength = length;
      allowed = rule.allow;
    }
  }

  return allowed;
}

/** The agents worth asking about: the one that matters, and the one everything else reads. */
const AUDITED_AGENTS = ["Googlebot", "*"];

function blockedFor(robots: RobotsTxt, path: string): string[] {
  return AUDITED_AGENTS.filter((agent) => !isPathAllowed(rulesForUserAgent(robots, agent), path));
}

export function checkRobotsTxt(body: string, origin: string): Finding[] {
  const robots = parseRobotsTxt(body);
  const findings: Finding[] = [];

  const expectedSitemap = `${origin}/sitemap.xml`;
  if (robots.sitemaps.length === 0) {
    findings.push(
      fail(
        "sitemap declared",
        `robots.txt names no Sitemap. It should name ${expectedSitemap} -- that line is ` +
          `how a crawler finds the sitemap without being told. See app/robots.ts.`,
      ),
    );
  } else if (!robots.sitemaps.includes(expectedSitemap)) {
    findings.push(
      fail(
        "sitemap declared",
        `robots.txt names ${robots.sitemaps.join(", ")}, expected ${expectedSitemap}. ` +
          `A Sitemap line on a different origin means ${SITE_URL_ENV_VAR} on the ` +
          `deployment does not match the site being audited.`,
      ),
    );
  } else {
    findings.push(pass("sitemap declared", expectedSitemap));
  }

  const blocked = blockedFor(robots, "/");
  findings.push(
    blocked.length === 0
      ? pass("crawlable", "/ is allowed for Googlebot and *")
      : fail(
          "crawlable",
          `robots.txt disallows / for ${blocked.join(", ")}. Nothing on this site would be ` +
            `indexed. See app/robots.ts.`,
        ),
  );

  return findings;
}

/**
 * `/auth/*` carries `noindex` from app/auth/layout.tsx and must NOT also be
 * disallowed: the two do not stack. A crawler forbidden from fetching the page
 * can never read the noindex on it, while the URL still gets indexed
 * contentless from its inbound links -- and /auth/sign-in has six.
 */
export function checkAuthPageCrawlable(body: string, path: string): Finding[] {
  const blocked = blockedFor(parseRobotsTxt(body), path);
  return [
    blocked.length === 0
      ? pass("crawlable", `${path} is allowed by robots.txt (so its noindex can be read)`)
      : fail(
          "crawlable",
          `robots.txt disallows ${path} for ${blocked.join(", ")}, which cancels out the ` +
            `noindex on it: a page a crawler may not fetch is a page whose noindex it can ` +
            `never read, and the URL still gets indexed from its inbound links. Allow the ` +
            `crawl, refuse the index. See app/robots.ts and app/auth/layout.tsx.`,
        ),
  ];
}

// ---------------------------------------------------------------------------
// sitemap.xml
// ---------------------------------------------------------------------------

export function parseSitemapUrls(xml: string): string[] {
  const urls: string[] = [];
  const pattern = /<loc>([\s\S]*?)<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const value = decodeEntities(match[1].trim());
    if (value !== "") urls.push(value);
  }
  return urls;
}

export function checkSitemap(urls: readonly string[], origin: string): Finding[] {
  const findings: Finding[] = [];

  if (urls.length === 0) {
    findings.push(
      fail(
        "sitemap parses",
        `No <loc> entries found. Either /sitemap.xml is not the sitemap (a 200 that serves ` +
          `HTML looks exactly like this) or app/sitemap.ts returned nothing.`,
      ),
    );
    return findings;
  }
  findings.push(pass("sitemap parses", `${urls.length} URLs`));

  const foreign = urls.filter((url) => !isOnOrigin(url, origin));
  findings.push(
    foreign.length === 0
      ? pass("sitemap origin", `all URLs on ${origin}`)
      : fail(
          "sitemap origin",
          `${foreign.length} of ${urls.length} sitemap URLs are not on ${origin} ` +
            `(e.g. ${foreign[0]}). This is the ${SITE_URL_ENV_VAR} failure in its pure form: ` +
            `the deployment is internally consistent and entirely wrong. Set ` +
            `${SITE_URL_ENV_VAR} in Vercel → Settings → Environment Variables for ` +
            `Production and redeploy.`,
        ),
  );

  const duplicates = [...new Set(urls.filter((url, index) => urls.indexOf(url) !== index))];
  if (duplicates.length > 0) {
    findings.push(
      fail("sitemap unique", `Duplicate <loc> entries: ${duplicates.join(", ")}. See app/sitemap.ts.`),
    );
  }

  return findings;
}

// ---------------------------------------------------------------------------
// HTML head
// ---------------------------------------------------------------------------

export interface PageTags {
  title: string | null;
  canonical: string | null;
  /** Keyed by the lowercased `name`/`property`; repeated tags keep every value. */
  meta: Map<string, string[]>;
  /** Raw bodies of every `<script type="application/ld+json">`. */
  jsonLd: string[];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match: string, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match: string, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/gi,
      (match: string, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match,
    );
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attributes.set(match[1].toLowerCase(), decodeEntities(value));
  }
  return attributes;
}

/**
 * A deliberately small tag reader rather than a DOM parse: the node test tier
 * has no jsdom, this only ever reads four kinds of tag, and every one of them
 * is emitted by Next from our own metadata objects.
 *
 * IT SCANS THE WHOLE DOCUMENT, NOT `<head>`, and that is not laziness. Next 15
 * streams metadata: for a client that supports it the entire block -- title,
 * canonical, every og tag -- is emitted late in the body, roughly 30KB past
 * `</head>` on this site, and only for the bots in Next's `htmlLimitedBots` list
 * is rendering blocked so the tags land in the head. Measured against this app
 * on 2026-08-07: reading `<head>` alone reported all nine pages as having no
 * title, no canonical and no og tags. An audit whose parser is wrong about
 * where the tags are is an audit that condemns a correct site.
 */
export function parsePageTags(html: string): PageTags {
  // Inline SVGs can carry their own <title> as an accessible name. None here do
  // today, but the first one to appear would otherwise be read as the page's
  // title -- and it would be read as a PASS, since a wrong title is still a
  // title.
  const document = html.replace(/<svg\b[\s\S]*?<\/svg>/gi, "");

  const titleMatch = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(document);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : null;

  let canonical: string | null = null;
  const meta = new Map<string, string[]>();

  const tagPattern = /<(meta|link)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(document)) !== null) {
    const attributes = parseAttributes(match[2]);
    if (match[1].toLowerCase() === "link") {
      const rel = attributes.get("rel")?.toLowerCase();
      const href = attributes.get("href");
      if (rel === "canonical" && href) canonical = href;
      continue;
    }
    // OG uses `property`, most everything else uses `name`. Both land in one
    // map so callers ask one question.
    const key = (attributes.get("property") ?? attributes.get("name"))?.toLowerCase();
    const content = attributes.get("content");
    if (!key || content === undefined) continue;
    const existing = meta.get(key);
    if (existing) existing.push(content);
    else meta.set(key, [content]);
  }

  const jsonLd: string[] = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  while ((match = scriptPattern.exec(document)) !== null) {
    const type = parseAttributes(match[1]).get("type")?.toLowerCase();
    if (type === "application/ld+json") jsonLd.push(match[2]);
  }

  return { title, canonical, meta, jsonLd };
}

function firstMeta(tags: PageTags, key: string): string | null {
  const values = tags.meta.get(key);
  return values && values.length > 0 ? values[0] : null;
}

export interface AuditedPage {
  /** The URL that served this HTML -- the sitemap <loc>, verbatim. */
  url: string;
  tags: PageTags;
}

export function checkPageTags(page: AuditedPage, origin: string): Finding[] {
  const { url, tags } = page;
  const findings: Finding[] = [];

  // -- canonical ------------------------------------------------------------
  if (!tags.canonical) {
    findings.push(
      fail(
        "canonical",
        `No <link rel="canonical">. A page without one can be indexed under any URL that ` +
          `reaches it (trailing slash, tracking params, a preview domain). Every page must ` +
          `go through buildPageMetadata (lib/seo/metadata.ts), which sets it.`,
      ),
    );
  } else if (!isOnOrigin(tags.canonical, origin)) {
    findings.push(
      fail(
        "canonical",
        `canonical is ${tags.canonical}, which is not on ${origin}. Either it is relative ` +
          `(canonicals must be absolute) or ${SITE_URL_ENV_VAR} on the deployment is wrong.`,
      ),
    );
  } else if (tags.canonical !== url) {
    findings.push(
      fail(
        "canonical",
        `canonical is ${tags.canonical} but this page was served from ${url}. The sitemap ` +
          `and the canonical disagree about the page's own address, so one of them is ` +
          `sending crawlers somewhere else. Compare app/sitemap.ts's entry with the path ` +
          `the page passes to buildPageMetadata.`,
      ),
    );
  } else {
    findings.push(pass("canonical", tags.canonical));
  }

  // -- title ----------------------------------------------------------------
  if (!tags.title) {
    findings.push(fail("title", "No <title>."));
  } else if (tags.title === SITE_NAME) {
    findings.push(
      fail(
        "title",
        `<title> is the bare site name (${SITE_NAME}). That is the root layout's value ` +
          `showing through, which means this page sets no title of its own -- it is ` +
          `indistinguishable from every other page in a result.`,
      ),
    );
  } else {
    findings.push(pass("title", tags.title));
  }

  // -- Open Graph -----------------------------------------------------------
  for (const key of ["og:title", "og:description", "og:image"]) {
    if (!firstMeta(tags, key)) {
      findings.push(
        fail(
          key,
          `No ${key}. Shared links render as a bare line of text without it. ` +
            `buildPageMetadata sets og:title and og:description; og:image comes from ` +
            `app/opengraph-image.tsx, which applies to every route below app/.`,
        ),
      );
    }
  }

  const ogImage = firstMeta(tags, "og:image");
  if (ogImage) {
    if (!isOnOrigin(ogImage, origin)) {
      findings.push(
        fail(
          "og:image origin",
          `og:image is ${ogImage}, not on ${origin}. A relative og:image is invalid per the ` +
            `spec and most scrapers drop it; an absolute one on another host means ` +
            `metadataBase resolved to the wrong origin (lib/seo/site.ts).`,
        ),
      );
    } else {
      findings.push(pass("og", `og:title, og:description, og:image on ${origin}`));
    }
  }

  // -- JSON-LD --------------------------------------------------------------
  findings.push(...checkJsonLd(tags));

  return findings;
}

export function checkJsonLd(tags: PageTags): Finding[] {
  if (tags.jsonLd.length === 0) return [];

  const problems: string[] = [];
  for (const [index, block] of tags.jsonLd.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch (error) {
      problems.push(
        `block ${index + 1} is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
      );
      continue;
    }
    // An array of entities is legal JSON-LD, so check each member rather than
    // rejecting the shape.
    const entities = Array.isArray(parsed) ? parsed : [parsed];
    for (const entity of entities) {
      if (typeof entity !== "object" || entity === null) {
        problems.push(`block ${index + 1} is not an object`);
        continue;
      }
      const record = entity as Record<string, unknown>;
      const missing = ["@context", "@type"].filter((key) => record[key] === undefined);
      if (missing.length > 0) problems.push(`block ${index + 1} is missing ${missing.join(" and ")}`);
    }
  }

  return [
    problems.length === 0
      ? pass("json-ld", `${tags.jsonLd.length} block(s) valid`)
      : fail(
          "json-ld",
          `${problems.join("; ")}. Structured data that does not parse is structured data ` +
            `that is silently ignored. See lib/seo/structuredData.ts.`,
        ),
  ];
}

// ---------------------------------------------------------------------------
// Cross-page checks
// ---------------------------------------------------------------------------

function duplicatesOf(entries: readonly { url: string; value: string | null }[]): Map<string, string[]> {
  const byValue = new Map<string, string[]>();
  for (const entry of entries) {
    if (!entry.value) continue;
    const urls = byValue.get(entry.value);
    if (urls) urls.push(entry.url);
    else byValue.set(entry.value, [entry.url]);
  }
  return new Map([...byValue].filter(([, urls]) => urls.length > 1));
}

/** Distinct non-null values, so a pass reports what was actually compared. */
function distinctCount(entries: readonly { value: string | null }[]): number {
  return new Set(entries.map((entry) => entry.value).filter((value) => value !== null)).size;
}

export function checkTitlesUnique(pages: readonly AuditedPage[]): Finding[] {
  const entries = pages.map((page) => ({ url: page.url, value: page.tags.title }));
  const duplicates = duplicatesOf(entries);
  // Counting `pages.length` here would report "9 distinct titles" for nine
  // pages that have none -- a green line describing the exact opposite of what
  // it found.
  if (duplicates.size === 0) {
    return [pass("titles unique", `${distinctCount(entries)} distinct <title>s across ${pages.length} pages`)];
  }

  return [...duplicates].map(([title, urls]) =>
    fail(
      "titles unique",
      `${urls.length} pages share the title "${title}": ${urls.join(", ")}. Two pages with ` +
        `one title compete for the same result and neither wins it.`,
    ),
  );
}

/**
 * Separate from the title check, and not redundant with it: this is the exact
 * failure buildPageMetadata exists to prevent. `title.template` in the root
 * layout applies to a page's `title` but NOT to `openGraph.title`, so a page
 * that sets `title` directly instead of going through the builder looks correct
 * in the browser tab and inherits the ROOT's headline on every social share.
 * Duplicate og:titles alongside distinct <title>s is that bug's signature.
 */
export function checkOgTitlesUnique(pages: readonly AuditedPage[]): Finding[] {
  const entries = pages.map((page) => ({ url: page.url, value: firstMeta(page.tags, "og:title") }));
  const duplicates = duplicatesOf(entries);
  if (duplicates.size === 0) {
    return [
      pass("og:titles unique", `${distinctCount(entries)} distinct og:titles across ${pages.length} pages`),
    ];
  }

  return [...duplicates].map(([title, urls]) =>
    fail(
      "og:titles unique",
      `${urls.length} pages share og:title "${title}": ${urls.join(", ")}. This is the ` +
        `bypass buildPageMetadata (lib/seo/metadata.ts) exists to prevent -- a page setting ` +
        `\`title\` without it keeps a correct tab title and inherits the root's OG headline, ` +
        `so every share of those pages carries the same card.`,
    ),
  );
}

// ---------------------------------------------------------------------------
// noindex
// ---------------------------------------------------------------------------

export function checkNoIndex(tags: PageTags, path: string): Finding[] {
  // Next emits the directive on `robots`; `googlebot` is an optional second
  // tag, and either carrying noindex is enough for the bot that reads it.
  const directives = [...(tags.meta.get("robots") ?? []), ...(tags.meta.get("googlebot") ?? [])];
  const noindex = directives.some((value) =>
    value
      .split(",")
      .map((token) => token.trim().toLowerCase())
      .includes("noindex"),
  );

  return [
    noindex
      ? pass("noindex", `${path} carries noindex (${directives.join(" | ")})`)
      : fail(
          "noindex",
          `${path} does not carry noindex. It is a step inside an auth flow, not a page ` +
            `anyone should land on from a search result. The directive comes from ` +
            `app/auth/layout.tsx, because both auth pages are "use client" and a client ` +
            `component cannot export metadata.`,
        ),
  ];
}

// ---------------------------------------------------------------------------
// The OG image itself
// ---------------------------------------------------------------------------

export function checkOgImageResponse(url: string, status: number, contentType: string | null): Finding[] {
  if (status !== 200) {
    return [
      fail(
        "og:image fetch",
        `${url} returned ${status}. The card is generated at request time by ` +
          `app/opengraph-image.tsx, and the classic cause of a 500 in production but not ` +
          `locally is a font file that is read at runtime and not named in next.config.ts's ` +
          `outputFileTracingIncludes -- Next traces static imports and cannot see a path ` +
          `built at runtime.`,
      ),
    ];
  }

  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "image/png") {
    return [
      fail(
        "og:image fetch",
        `${url} returned 200 but content-type is ${contentType ?? "(absent)"}, expected ` +
          `image/png. Scrapers dispatch on the header, not the extension.`,
      ),
    ];
  }

  return [pass("og:image fetch", `200 image/png — ${url}`)];
}
