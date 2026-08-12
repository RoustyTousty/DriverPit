import type { MetadataRoute } from "next";

import { archivePageCount, archivePagePath } from "@/components/archive/ArchiveIndex";
import {
  countArchiveDays,
  listArchiveDayEvidence,
  listDriverArchiveEvidence,
} from "@/lib/db/dailyRecap";
import { isDriverPageEligible } from "@/lib/drivers/pageEligibility";
import { isArchiveDayIndexable } from "@/lib/recap/dayEligibility";
import { localePath } from "@/lib/i18n/locales";
import { INDEXED_LOCALES, alternateLanguages } from "@/lib/seo/metadata";
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
 * One unprefixed path becomes one `<loc>` PER INDEXED LOCALE, each carrying the
 * whole alternate set including itself.
 *
 * Both halves are what Google asks for and both are easy to get wrong in a way
 * that produces a valid file saying the wrong thing. Listing only one URL and
 * hanging alternates off it leaves the other versions never appearing as a
 * `<loc>` at all; listing them all but omitting the self-reference makes each
 * one an orphan rather than a member of a set, and Google drops the whole
 * cluster.
 *
 * `INDEXED_LOCALES`, not `LOCALES`: since 2026-08-12 that is English alone (see
 * the block comment on it). A sitemap is a list of URLs we are ASKING to have
 * indexed, so listing a `noindex` page in one is the same contradiction as
 * hanging an hreflang off it -- and it is the version a reviewer actually
 * counts, which is the whole reason this pass exists. When a locale is promoted
 * back, it reappears here with no edit.
 *
 * Both the URL list and the alternates come from the SAME two exports
 * `buildPageMetadata` uses, so the sitemap and the pages cannot disagree about
 * which URLs exist. Two sources for that would be two answers, and the
 * sitemap's would be the one nobody checks.
 */
function localizedEntries(path: string, rest: Omit<SitemapEntry, "url" | "alternates">): SitemapEntry[] {
  const languages = alternateLanguages(path);
  return INDEXED_LOCALES.map((locale) => ({
    url: absoluteUrl(localePath(locale, path)),
    ...rest,
    // Omitted entirely below two indexed locales rather than emitted empty: a
    // <xhtml:link> block naming only the page itself is noise on every entry.
    ...(languages ? { alternates: { languages } } : {}),
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
  // The longest hand-written page on the site and the one with the clearest
  // query behind it ("f1 wordle strategy", "best first guess"). Ranked with
  // how-to-play rather than below it: it is the page that answers the question
  // somebody has AFTER they have played once, which is the more valuable half.
  { path: "/strategy", changeFrequency: "monthly", priority: 0.8 },
  { path: "/game-modes", changeFrequency: "monthly", priority: 0.8 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.7 },
  { path: "/about", changeFrequency: "monthly", priority: 0.5 },
  // Low priority and rarely changing, but it must be IN the file: a contact
  // route that exists and is not discoverable does not do the job it was added
  // for. Same reasoning as the legal pages below it.
  { path: "/contact", changeFrequency: "yearly", priority: 0.3 },
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
    const [days, totalDays] = await Promise.all([listArchiveDayEvidence(), countArchiveDays()]);

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

    // Only the days that carry player data. `isArchiveDayIndexable` is the SAME
    // predicate the day page's generateMetadata applies to decide `noIndex`, so
    // this file and that page can never disagree -- a sitemap advertising a URL
    // that then serves `noindex` is worse than one that omits it, and it is the
    // contradiction a reviewer notices first. The threshold and the reasoning
    // are in lib/recap/dayEligibility.ts; the count comes from the query, which
    // deliberately does not apply it.
    //
    // The index pages above are NOT filtered: the archive lists every finished
    // day, including the quiet ones, so the index stays honest about what
    // exists and stays the path a crawler follows inward. It is the individual
    // empty day that has nothing to say, not the list of them.
    const dayEntries = days.filter(isArchiveDayIndexable).flatMap(({ date }) =>
      localizedEntries(`/archive/${date}`, {
        // A finished day is frozen -- nothing behind these pages can change
        // again, and saying so is both true and the most useful thing a crawler
        // can be told about 365 near-identical URLs.
        lastModified: new Date(`${date}T00:00:00.000Z`),
        changeFrequency: "yearly" as const,
        priority: 0.6,
      }),
    );

    return [...indexes, ...dayEntries];
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
