import type { MetadataRoute } from "next";

import { archivePageCount, archivePagePath } from "@/components/archive/ArchiveIndex";
import { countArchiveDays, listArchiveDates, listDriverArchiveEvidence } from "@/lib/db/dailyRecap";
import { isDriverPageEligible } from "@/lib/drivers/pageEligibility";
import { LOCALES, localePath } from "@/lib/i18n/locales";
import { alternateLanguages } from "@/lib/seo/metadata";
import { absoluteUrl } from "@/lib/seo/site";

// Served at /sitemap.xml and pointed to by robots.ts.
//
// The routes come from one hand-kept list rather than from a filesystem walk of
// `app/`, because the two questions are different: `app/` contains the auth
// pages, the route handlers and `/daily` (a redirect), none of which belong in a
// sitemap, and a walk would need an exclude list as long as this include list.
//
// `changeFrequency` and `priority` are advisory and Google has said for years it
// largely ignores both; they are set here because Bing and smaller crawlers do
// read them, and because "the daily puzzle changes daily" is true and free to
// state. What Google does use is `lastModified`, which is why the daily route
// gets a real one -- see below.
//
// The archive entries are appended below, one per finished day plus the index
// pages, read from `daily_targets`. That makes this a database read, so it can
// no longer be a build-time static file -- hence `revalidate`.

type SitemapEntry = MetadataRoute.Sitemap[number];

interface RouteSpec {
  path: string;
  changeFrequency: NonNullable<SitemapEntry["changeFrequency"]>;
  priority: number;
}

/**
 * One unprefixed path becomes one `<loc>` PER LOCALE, and every one of them
 * carries the whole alternate set including itself.
 *
 * Both halves are what Google asks for and both are easy to get wrong in a way
 * that produces a valid file saying the wrong thing. Listing only the English
 * URL and hanging alternates off it leaves five of the six versions never
 * appearing as a `<loc>` at all; listing all six but omitting the
 * self-reference makes each one an orphan rather than a member of a set, and
 * Google drops the whole cluster.
 *
 * The alternates are `alternateLanguages` — the SAME function `buildPageMetadata`
 * uses for the `<link rel="alternate">` tags — so the sitemap and the pages
 * cannot disagree about which URLs exist. Two sources for that would be two
 * answers, and the sitemap's would be the one nobody checks.
 */
function localizedEntries(path: string, rest: Omit<SitemapEntry, "url" | "alternates">): SitemapEntry[] {
  const languages = alternateLanguages(path);
  return LOCALES.map((locale) => ({
    url: absoluteUrl(localePath(locale, path)),
    ...rest,
    alternates: { languages },
  }));
}

// The daily route, named once: it is the sitemap's priority-1 entry and the one
// entry that carries a lastModified, and those two must agree about which path
// they mean.
const DAILY_PATH = "/";

const ROUTES: RouteSpec[] = [
  // The game itself, served at the root since Pass 5 -- `/daily` now 308s here,
  // so this is the URL that should rank and the only one with priority 1. A
  // sitemap must list final URLs; listing the redirect would be the own-goal
  // `npm run seo:audit` checks for.
  { path: DAILY_PATH, changeFrequency: "daily", priority: 1 },
  // The two differentiators: no competing F1 guessing game has unlimited
  // filtered practice or real-time 1v1, so these are the pages with a genuine
  // shot at their queries.
  { path: "/infinite", changeFrequency: "weekly", priority: 0.9 },
  { path: "/online", changeFrequency: "weekly", priority: 0.9 },
  { path: "/how-to-play", changeFrequency: "monthly", priority: 0.8 },
  { path: "/game-modes", changeFrequency: "monthly", priority: 0.8 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.7 },
  { path: "/about", changeFrequency: "monthly", priority: 0.5 },
  { path: "/privacy-policy", changeFrequency: "yearly", priority: 0.2 },
  { path: "/terms-of-service", changeFrequency: "yearly", priority: 0.2 },
];

// Regenerated hourly rather than at build time: the archive gains a day every
// midnight UTC, and a sitemap that only changes when someone deploys would
// stop listing new pages during any quiet week.
export const revalidate = 3600;

/**
 * The archive's own URLs, or an empty list if the database cannot be reached.
 *
 * Swallowing the error is deliberate and is the lesser of two bad outcomes: a
 * sitemap that throws returns a 500 for the WHOLE file, so a transient blip
 * would delist the nine static pages as well — Search Console reports the
 * fetch failure and stops trusting the file. Returning the static routes alone
 * degrades to exactly what shipped before this pass. It is logged because a
 * silent shortfall here is otherwise invisible: nothing renders wrong, the
 * archive simply stops being discoverable.
 */
async function archiveEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    const [dates, totalDays] = await Promise.all([listArchiveDates(), countArchiveDays()]);

    // Index pages first: they are how a crawler reaches the day pages, so they
    // are worth more than any individual day.
    const indexes = Array.from({ length: archivePageCount(totalDays) }, (_, i) =>
      localizedEntries(archivePagePath(i + 1), {
        changeFrequency: "daily" as const,
        // Page 1 gains a row daily; later pages only shift when the archive grows
        // past another boundary, but they are still the paths inward.
        priority: i === 0 ? 0.8 : 0.4,
      }),
    ).flat();

    const days = dates.flatMap((date) =>
      localizedEntries(`/archive/${date}`, {
        // A finished day is frozen -- nothing behind these pages can change
        // again, and saying so is both true and the most useful thing a crawler
        // can be told about 365 near-identical URLs.
        lastModified: new Date(`${date}T00:00:00.000Z`),
        changeFrequency: "yearly" as const,
        priority: 0.6,
      }),
    );

    return [...indexes, ...days];
  } catch (error) {
    console.error("sitemap: archive entries unavailable", error);
    return [];
  }
}

/**
 * The driver pages that exist, or an empty list if the database cannot be
 * reached — same fail-soft contract as `archiveEntries`, and for the same
 * reason.
 *
 * It applies `isDriverPageEligible` rather than trusting the query, because the
 * page's own 404 applies it too: a sitemap listing a URL that 404s is worse than
 * one that omits it, and the only way those two can never disagree is for both
 * to call the predicate.
 *
 * No `lastModified`. A driver page changes when its subject is the answer again
 * or when the seed refreshes their wins — neither of which is a date this query
 * knows, and a fabricated one is how a sitemap's timestamps stop being believed.
 */
async function driverEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    const evidence = await listDriverArchiveEvidence();
    return evidence
      .filter((driver) => isDriverPageEligible(driver.appearances))
      .flatMap((driver) =>
        localizedEntries(`/drivers/${driver.slug}`, {
          changeFrequency: "monthly" as const,
          priority: 0.5,
        }),
      );
  } catch (error) {
    console.error("sitemap: driver entries unavailable", error);
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Today's UTC midnight, not `new Date()`. The puzzle turns over at 00:00 UTC
  // and nothing about it changes in between, so stamping the current instant
  // would tell crawlers the page changed at 14:32 when it did not -- a sitemap
  // whose lastModified moves on every fetch is a sitemap whose lastModified gets
  // ignored. This is also why the static pages carry no lastModified at all
  // rather than a build timestamp: a redeploy is not an edit, and claiming one
  // on nine pages at once is the fastest way to be disbelieved on all of them.
  const todayUtc = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

  const staticEntries = ROUTES.flatMap(({ path, changeFrequency, priority }) =>
    localizedEntries(path, {
      changeFrequency,
      priority,
      ...(path === DAILY_PATH ? { lastModified: todayUtc } : {}),
    }),
  );

  // In parallel: two independent reads, and one being slow should not delay the
  // other on a file regenerated hourly.
  const [archive, drivers] = await Promise.all([archiveEntries(), driverEntries()]);
  return [...staticEntries, ...archive, ...drivers];
}
