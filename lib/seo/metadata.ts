import type { Metadata } from "next";

import { DEFAULT_LOCALE, LOCALES, type Locale, OG_LOCALES, localePath } from "@/lib/i18n/locales";

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
 * The hreflang set for one unprefixed path.
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
 */
export function alternateLanguages(path: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of LOCALES) {
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

  return {
    title,
    description,
    alternates: {
      canonical: url,
      // A noindex page advertises no alternates. Publishing an hreflang set for
      // a page you are asking not to be indexed is a contradictory pair of
      // signals, and it is the two `/auth/*` pages that would send it.
      ...(noIndex ? {} : { languages: alternateLanguages(path) }),
    },
    ...(noIndex ? { robots: { index: false, follow: true } } : {}),
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
