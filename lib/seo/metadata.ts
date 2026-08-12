import type { Metadata } from "next";

import { DEFAULT_LOCALE, type Locale, OG_LOCALES, localePath } from "@/lib/i18n/locales";

import { OG_IMAGE, SITE_NAME, absoluteUrl } from "./site";

// Every page's metadata is built here, and the reason is one Next.js rule that
// is easy to get wrong quietly: `title.template` in the root layout applies to a
// page's `title`, but NOT to `openGraph.title` or `twitter.title`. A page that
// sets only `title` therefore renders "How to play – DriverPit" in the tab and
// inherits the ROOT's OG title on every share -- so nine pages share one social
// card headline and nobody notices, because the tab title looks right.
//
// The same trap applies to `alternates.canonical`: absent, it is simply not
// emitted, and a page with no canonical is a page that can be indexed under any
// URL that happens to reach it (trailing slash, tracking params, a preview
// domain).
//
// Pass 7 added a third thing that can only be done in one place: `hreflang`.
// See `alternateLanguages` below.
//
// So: one builder, every page calls it, and none of the four can drift.

export interface PageMetadataInput {
  /** Tab title WITHOUT the site name -- the root template appends it. */
  title: string;
  description: string;
  /**
   * Site-relative and UNPREFIXED, leading slash, no trailing slash ("/faq",
   * "/"). The locale prefix is applied here. Passing an already-prefixed path
   * would produce `/es/es/faq`, so callers keep storing routes exactly as they
   * did before Pass 7.
   */
  path: string;
  /** The locale this page is being rendered in. Drives the canonical and og:locale. */
  locale: Locale;
  /**
   * Page-specific social card. Omit to get the site-wide one, which is what
   * almost every page should do.
   *
   * "Omit to INHERIT it" was the original wording and it was wrong in a way
   * that cost the site every social card it had: setting `openGraph` at all
   * replaces the parent's resolved value, image included. See OG_IMAGE in
   * ./site.ts. So the default is applied here, explicitly, rather than left to
   * a merge that does not happen.
   */
  image?: { url: string; width: number; height: number; alt: string };
  /** Keeps a page out of the index while leaving it reachable and crawlable. */
  noIndex?: boolean;
}

/**
 * The site-wide social card for a locale.
 *
 * The card is generated per locale (app/[locale]/opengraph-image.tsx) because
 * its headline is the site's one-line pitch, and a Spanish page sharing an
 * English card is the single most visible place a half-translated site shows.
 * Named explicitly on every page for the reason OG_IMAGE documents: Next's
 * file-convention merge does not survive a segment that sets `openGraph`.
 */
export function localeOgImage(locale: Locale) {
  return { ...OG_IMAGE, url: localePath(locale, OG_IMAGE.url) };
}

/**
 * WHICH LOCALES ARE OFFERED TO SEARCH ENGINES. English only, for now.
 *
 * This is a deliberate retreat from Pass 7, made on 2026-08-12 after AdSense
 * rejected the site for "low value content", and it is the one lever that
 * changes the indexed surface most: every URL on this site exists six times,
 * and five of those six are produced by `npm run i18n:translate` -- machine
 * translation, which Google's own spam guidance singles out when it is
 * published without human review. Multiplying a young site's page count by six
 * that way is the single loudest scaled-content signal it can send, and it was
 * being sent across the archive's auto-generated stats pages as well as the
 * hand-written ones.
 *
 * What this does NOT do is stop serving the translations. `/es/faq` still
 * renders in Spanish for anyone who asks for it and the language switcher still
 * works; the five prefixed locales simply carry `noindex, follow` and advertise
 * no alternates, and the sitemap lists English alone. Users keep the feature,
 * crawlers are offered one version of each page.
 *
 * TO RE-ENABLE, once the catalogues have been read by a human and the in-app
 * UI is translated too: put the locales back in this list. Nothing else has to
 * change -- `buildPageMetadata` and the sitemap both read it, the hreflang set
 * reappears the moment there is more than one entry, and `alternateLanguages`
 * below is written to stay correct at any length. It is a list rather than a
 * boolean so a locale can be promoted one at a time as its catalogue is
 * reviewed, which is how this should come back.
 */
export const INDEXED_LOCALES: readonly Locale[] = [DEFAULT_LOCALE];

/** Is this locale offered to crawlers, or served to users only? */
export function isIndexedLocale(locale: Locale): boolean {
  return INDEXED_LOCALES.includes(locale);
}

/**
 * The hreflang set for one unprefixed path, or `undefined` when there is no set
 * worth publishing.
 *
 * Three rules, each of which is a way to get this silently wrong:
 *
 *  - **Every locale lists every other locale, including itself.** Google treats
 *    a page that omits its own self-referential alternate as not part of the
 *    set, and drops the whole cluster.
 *  - **`x-default` points at the English URL**, which is the unprefixed one.
 *    It means "use this when no listed language fits", and the default locale
 *    is the only honest answer to that on this site.
 *  - **The keys are BCP-47 tags, not URL prefixes.** `pt-BR` is served at
 *    the tag is what other consumers read, so it is written exactly as
 *    the BCP-47 spec defines it.
 *
 * And one rule added with `INDEXED_LOCALES`: the set is drawn from the INDEXED
 * locales, not from `LOCALES`, and collapses to `undefined` below two entries.
 * Both halves matter. An hreflang cluster that names a `noindex` page is a
 * contradictory pair of signals -- the same reason a `noIndex` page here has
 * never advertised alternates -- and a "cluster" of one self-reference plus an
 * x-default pointing at that same URL says nothing at all, so it is noise on
 * every page rather than a signal on any.
 */
export function alternateLanguages(path: string): Record<string, string> | undefined {
  if (INDEXED_LOCALES.length < 2) return undefined;

  const languages: Record<string, string> = {};
  for (const locale of INDEXED_LOCALES) {
    languages[locale] = absoluteUrl(localePath(locale, path));
  }
  languages["x-default"] = absoluteUrl(localePath(DEFAULT_LOCALE, path));
  return languages;
}

export function buildPageMetadata({
  title,
  description,
  path,
  locale,
  image,
  noIndex,
}: PageMetadataInput): Metadata {
  // OG and Twitter have no template mechanism, so the site name is composed in
  // here -- with the same separator the root template uses, or a share and a
  // tab would spell the same title two ways.
  const fullTitle = `${title} – ${SITE_NAME}`;
  const url = absoluteUrl(localePath(locale, path));
  const card = image ?? localeOgImage(locale);

  // Two independent reasons a page is not offered to the index, resolved into
  // one answer here so nothing downstream has to ask twice: the caller said so
  // (the two `/auth/*` pages, and the thin archive days), or the whole locale is
  // served-but-not-indexed (see INDEXED_LOCALES).
  //
  // `follow` stays true in both cases. These pages are reachable, their links
  // are real, and the crawler is being asked not to index this URL -- not to
  // stop reading the site through it.
  const indexed = !noIndex && isIndexedLocale(locale);

  // A page that is not indexed advertises no alternates. Publishing an hreflang
  // set for a page you are asking not to index is a contradictory pair of
  // signals.
  const languages = indexed ? alternateLanguages(path) : undefined;

  return {
    title,
    description,
    alternates: {
      // Self-canonical even when noindexed, which is the consistent pair: it
      // says "this URL is the original of what it serves", and the robots
      // directive separately says not to index it. Pointing a Spanish page's
      // canonical at the English one instead would be a different and false
      // claim -- that they are the same page -- on a page whose whole purpose
      // is to be a different one.
      canonical: url,
      ...(languages ? { languages } : {}),
    },
    ...(indexed ? {} : { robots: { index: false, follow: true } }),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: OG_LOCALES[locale],
      title: fullTitle,
      description,
      url,
      images: [card],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [card.url],
    },
  };
}
