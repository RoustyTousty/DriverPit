// The pure half of `npm run indexnow` — IndexNow submission planning.
//
// IndexNow (https://www.indexnow.org) is an open push protocol: instead of
// waiting for a crawler to come back, the site tells it a URL changed. Bing,
// Yandex, Seznam and Naver share one endpoint, so a single POST reaches all of
// them. Google does not participate, and nothing here is a substitute for
// Search Console — see docs/seo-roadmap.md.
//
// It is worth automating on THIS site specifically because the archive gains a
// page every midnight UTC (app/sitemap.ts, `archiveEntries`). That is a stream
// of new URLs arriving on a schedule with nobody deploying, which is exactly
// the case a crawl budget handles worst and a push handles best.
//
// Everything here is pure — parsing and set arithmetic over strings — so
// indexNow.test.ts can exercise it in the static CI tier with no network and no
// deployment. The fetching, the POST and the exit code live in
// scripts/indexNow.ts. Same split as seoAuditChecks.ts / seoAudit.ts and
// flagSubset.ts / generateFlagSubset.ts.

/**
 * The key that proves we own the domain, and therefore the name of the file
 * that must be served at the origin root: `/<key>.txt`, containing the key.
 *
 * **This is deliberately committed and is not a secret.** The protocol requires
 * the same value to be publicly fetchable at that URL, so hiding it in an env
 * var would protect nothing while adding a second place for it to drift from
 * the filename. The worst an outsider can do with it is submit OUR OWN URLs for
 * indexing, which is what this script does on purpose.
 *
 * The file lives at `public/<key>.txt`. `indexNow.test.ts` asserts that file
 * exists and contains exactly this string, because the two are a filename/value
 * pair that nothing else type-checks: rotate the key here without renaming the
 * file and every submission comes back 403 with the site otherwise fine.
 *
 * Root placement is load-bearing. A key file served from a subdirectory limits
 * submissions to URLs under that same subdirectory, so `/drivers/...` could not
 * be submitted from a key at `/api/`.
 */
export const INDEXNOW_KEY = "a4524ed776337b0b19e42b215de77325";

/** Where the key file must be reachable, relative to the origin. */
export const INDEXNOW_KEY_PATH = `/${INDEXNOW_KEY}.txt`;

/**
 * The shared endpoint. Submitting here fans out to every participating engine,
 * so there is no per-engine list to maintain.
 */
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** Protocol ceiling on one request. */
export const MAX_URLS_PER_REQUEST = 10_000;

// ---------------------------------------------------------------------------
// Reading the sitemap
// ---------------------------------------------------------------------------

export interface SitemapEntry {
  url: string;
  /** The `<lastmod>` verbatim, or null when the entry declares none. */
  lastModified: string | null;
}

/**
 * Pulls `<loc>`/`<lastmod>` pairs out of a sitemap.
 *
 * Regex rather than an XML parser, for the reason scripts/seoAuditChecks.ts
 * gives for the same choice: this reads one file whose shape Next generates, a
 * dependency would be carried for one call site, and a malformed sitemap should
 * produce a short list we can report on rather than a thrown parse error.
 *
 * Entries are matched as whole `<url>` blocks rather than by scanning for
 * `<loc>` and `<lastmod>` independently — the two are only associated by which
 * block they sit in, and a flat scan silently pairs one entry's URL with the
 * next entry's date the moment any entry omits a `<lastmod>`. Most of this
 * sitemap does omit it.
 */
export function parseSitemapEntries(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];

  for (const block of xml.match(/<url\b[\s\S]*?<\/url>/g) ?? []) {
    const loc = block.match(/<loc>([\s\S]*?)<\/loc>/)?.[1]?.trim();
    if (!loc) continue;
    const lastmod = block.match(/<lastmod>([\s\S]*?)<\/lastmod>/)?.[1]?.trim();
    entries.push({ url: loc, lastModified: lastmod && lastmod !== "" ? lastmod : null });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Deciding what to submit
// ---------------------------------------------------------------------------

/**
 * What was submitted last time: URL → the `<lastmod>` it carried then (empty
 * string when it carried none).
 *
 * Persisted between runs by the caller. The GitHub workflow keeps it in the
 * Actions cache rather than committing it back, because a daily commit whose
 * only content is a timestamp is noise in the history of a repo where the log
 * is read.
 */
export type SubmissionState = Record<string, string>;

export interface SubmissionPlan {
  urls: string[];
  /** Human-readable, for the run log — a submission nobody can explain is one nobody trusts. */
  reason: string;
  /** The state to persist for the next run, whether or not the POST happens. */
  nextState: SubmissionState;
}

/**
 * Which URLs have actually changed since the last run.
 *
 * Three rules, and the second is the one that stops this becoming spam:
 *
 *  - **No previous state ⇒ submit everything.** This is the first run, or the
 *    Actions cache was evicted. Resubmitting an unchanged URL is tolerated by
 *    the protocol; missing a new one defeats the point of having it.
 *  - **A URL is submitted when it is new, or when its `<lastmod>` moved.**
 *    `/` carries today's UTC midnight and so is submitted daily, which is
 *    honest — the daily puzzle genuinely changes. An archive day page carries
 *    its own frozen date, so it is submitted once, on the run after it becomes
 *    indexable. That timing is why the diff is against stored state rather than
 *    against a "lastmod within N days" window: a day only enters the sitemap
 *    once somebody completes a board on it (lib/recap/dayEligibility.ts), which
 *    can be long after the date it carries, and a date window would silently
 *    skip exactly those.
 *  - **An entry with no `<lastmod>` is submitted only on first sight.** Driver
 *    pages and the archive index pages are in this group. The archive index
 *    does gain a row daily without saying so, and that is accepted rather than
 *    worked around: what needs indexing is the day page, which is submitted on
 *    its own the same run.
 */
export function planSubmission(
  entries: SitemapEntry[],
  previous: SubmissionState | null,
): SubmissionPlan {
  const nextState: SubmissionState = {};
  for (const entry of entries) nextState[entry.url] = entry.lastModified ?? "";

  if (previous === null) {
    return {
      urls: entries.map((entry) => entry.url),
      reason: `no previous state — submitting all ${entries.length} sitemap URLs`,
      nextState,
    };
  }

  const urls = entries
    .filter((entry) => previous[entry.url] !== (entry.lastModified ?? ""))
    .map((entry) => entry.url);

  const added = urls.filter((url) => !(url in previous)).length;
  return {
    urls,
    reason:
      urls.length === 0
        ? "nothing changed since the last run"
        : `${urls.length} changed (${added} new, ${urls.length - added} updated) of ${entries.length}`,
    nextState,
  };
}

// ---------------------------------------------------------------------------
// Building the request
// ---------------------------------------------------------------------------

export interface IndexNowPayload {
  host: string;
  key: string;
  urlList: string[];
}

/**
 * Splits a URL list into requests the endpoint will accept.
 *
 * At 25 URLs this site is three orders of magnitude below the ceiling and will
 * be for decades. It is here anyway because the archive grows without anybody
 * deciding to grow it, and the failure it prevents is a flat 400 on the whole
 * batch rather than a partial success — the kind of thing that would first be
 * noticed as "indexing stopped working some time last year".
 */
export function chunkUrls(urls: string[], size = MAX_URLS_PER_REQUEST): string[][] {
  if (urls.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < urls.length; i += size) chunks.push(urls.slice(i, i + size));
  return chunks;
}

/**
 * The POST body for one batch.
 *
 * `host` is the bare hostname, not the origin: the protocol compares each
 * submitted URL's host against it and answers 422 for the whole batch on a
 * mismatch, so passing `https://driverpit.app` here rejects every URL under it.
 */
export function buildPayload(origin: string, urls: string[]): IndexNowPayload {
  return { host: new URL(origin).host, key: INDEXNOW_KEY, urlList: urls };
}

/**
 * URLs that are not on the origin being submitted for.
 *
 * Checked before the POST rather than after, because the endpoint rejects the
 * BATCH on a single foreign URL (422) — so one bad entry silently costs every
 * good one beside it, and the response says only "URLs don't belong to the
 * host". On this site a foreign URL in the sitemap means `NEXT_PUBLIC_SITE_URL`
 * disagrees with the domain being submitted for, which is worth naming plainly.
 */
export function foreignUrls(origin: string, urls: string[]): string[] {
  const host = new URL(origin).host;
  return urls.filter((url) => {
    try {
      return new URL(url).host !== host;
    } catch {
      return true;
    }
  });
}

/**
 * What an IndexNow response code means, in the terms the operator needs.
 *
 * 202 is the one worth spelling out: it is a SUCCESS — the URLs were taken and
 * the key is being verified — but it reads like a warning, and on a first run
 * it is the expected answer rather than a problem.
 */
export function describeResponse(status: number): { ok: boolean; message: string } {
  switch (status) {
    case 200:
      return { ok: true, message: "accepted" };
    case 202:
      return { ok: true, message: "accepted — key validation pending (normal on a first run)" };
    case 400:
      return { ok: false, message: "bad request — malformed payload" };
    case 403:
      return {
        ok: false,
        message: `key rejected — check ${INDEXNOW_KEY_PATH} is served at the origin root and contains the key`,
      };
    case 422:
      return { ok: false, message: "URLs do not match the submitted host, or the key is malformed" };
    case 429:
      return { ok: false, message: "rate limited — submitting too often" };
    default:
      return { ok: false, message: `unexpected status ${status}` };
  }
}
