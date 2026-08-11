import { type Locale, localePath } from "@/lib/i18n/locales";

import { SITE_NAME, absoluteUrl } from "./site";

// Every entity here takes the locale and applies it to both `url` and
// `inLanguage`. Neither is decorative: a `WebSite` entity declaring the English
// URL on six localised pages says the six are one page, and `inLanguage` is what
// tells an answer engine which of them to quote back to a Spanish question. The
// descriptive strings come from the message catalogue rather than from
// SITE_DESCRIPTION, so the markup says the same thing the page does.

// JSON-LD, built as plain objects so the shapes are unit-testable and so no
// component ever hand-writes a `<script type="application/ld+json">` body by
// string concatenation (which is an HTML injection site the moment any of the
// values stop being literals -- see components/seo/JsonLd.tsx for how the
// serialization is escaped).
//
// WHAT THIS REALISTICALLY BUYS, stated honestly so nobody expands it expecting
// more: Google restricted FAQ rich results to government and health sites in
// 2023, so the FAQPage block below is very unlikely to draw an expandable
// snippet on a game site. It is still worth the ~1KB -- Bing renders them, and
// structured data is how search engines and LLM-backed answer engines resolve
// "what is DriverPit" to an entity rather than to a string. What it is NOT is a
// ranking lever, and no amount of additional schema will substitute for the
// archive pages. Never add `aggregateRating` here: we have no ratings, and
// fabricated ones are a manual-action offence, not a grey area.

// A minimal JSON value type. `any` is banned in this repo and the JSON-LD
// shapes are heterogeneous enough that a union beats fifteen interfaces.
export type JsonLdValue = string | number | boolean | null | JsonLdValue[] | { [key: string]: JsonLdValue };
export type JsonLdObject = { [key: string]: JsonLdValue };

/** Site-level identity. Rendered once, in the root layout. */
export function websiteJsonLd(locale: Locale, description: string): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: absoluteUrl(localePath(locale, "/")),
    description,
    inLanguage: locale,
  };
}

/**
 * The game itself. Rendered on the daily page (`/`), not in the layout: the
 * layout wraps three routes, and emitting the same entity three times says the
 * site has three games rather than one.
 */
export function videoGameJsonLd(locale: Locale, description: string): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "VideoGame",
    name: SITE_NAME,
    // The page the entity is rendered on, which is also the site's front door.
    // Naming the old /daily here would point the entity at a 308.
    url: absoluteUrl(localePath(locale, "/")),
    description,
    inLanguage: locale,
    genre: ["Puzzle", "Word game", "Sports"],
    gamePlatform: "Web browser",
    operatingSystem: "Any",
    applicationCategory: "GameApplication",
    // Both, and the second one is the differentiator worth declaring: every
    // competing F1 -dle is single-player only.
    playMode: ["SinglePlayer", "MultiPlayer"],
    // Free to play, and explicit rather than absent -- "is this free" is a real
    // pre-click question and an Offer at price 0 answers it in the markup.
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  };
}

/**
 * `Home → Archive → 31 July 2026`, rendered on every archive page.
 *
 * The one schema type here with a real chance of showing up in a result: Google
 * replaces the URL line of a snippet with the breadcrumb trail, which on a URL
 * as opaque as `/archive/2026-07-31` is a genuine improvement in what a searcher
 * sees before clicking.
 *
 * `item` must be an absolute URL and the positions must start at 1 and not
 * skip — both are silently ignored rather than reported when wrong, which is
 * why they are built here from `absoluteUrl` and an index rather than typed out
 * per page.
 */
export function breadcrumbJsonLd(
  locale: Locale,
  trail: readonly { name: string; path: string }[],
): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      // Locale-prefixed like every other URL this file emits: a Spanish
      // breadcrumb whose trail links the English pages sends the reader out of
      // the locale on the one control that exists to move them around inside it.
      item: absoluteUrl(localePath(locale, crumb.path)),
    })),
  };
}

export interface DriverPersonInput {
  fullName: string;
  nationality: string;
  locale: Locale;
  /** Site-relative, UNPREFIXED path of the driver's own page. */
  path: string;
  /** Localised "Formula One driver". */
  jobTitle: string;
  /** `YYYY-MM-DD`. */
  birthDate: string;
  /** `YYYY-MM-DD`, or null for a living driver. */
  deathDate: string | null;
}

/**
 * A driver, on their own page (roadmap Pass 6).
 *
 * `Person` rather than `Athlete`: schema.org has no Athlete type — the closest
 * is `SportsTeam`/`SportsOrganization` for the other side of the relationship —
 * and inventing one produces a block consumers silently ignore. `jobTitle`
 * carries what `Person` cannot express structurally.
 *
 * NO `aggregateRating` and no `review`, here least of all. This is markup about
 * a real, named, mostly-living person, so a fabricated rating on it is both the
 * manual-action offence the roadmap names and a claim about someone who did not
 * ask to be scored. structuredData.test.ts asserts their absence.
 */
export function driverPersonJsonLd({
  fullName,
  nationality,
  locale,
  path,
  jobTitle,
  birthDate,
  deathDate,
}: DriverPersonInput): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    // NOT translated, here or anywhere: a driver's name and their team's name
    // are proper nouns, and "Lewis Hamilton" is what someone searches in every
    // locale. Same rule as the `drivers` table itself (roadmap Pass 7).
    name: fullName,
    url: absoluteUrl(localePath(locale, path)),
    jobTitle,
    // A Country entity rather than a bare string: `nationality` expects a
    // Country, and a string there is dropped rather than reported.
    nationality: { "@type": "Country", name: nationality },
    birthDate,
    // Omitted rather than null for a living driver -- JSON-LD has no meaning for
    // a null and a consumer reading one may discard the whole property.
    ...(deathDate ? { deathDate } : {}),
  };
}

export interface FaqEntry {
  q: string;
  a: string;
}

/** Rendered on /faq only, from the same array the page renders visibly. */
export function faqPageJsonLd(entries: readonly FaqEntry[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.q,
      acceptedAnswer: { "@type": "Answer", text: entry.a },
    })),
  };
}
