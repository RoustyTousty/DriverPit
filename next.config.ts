import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

import { LOCALES, localePath } from "./lib/i18n/locales";

// The request config lives under lib/ with the rest of this repo's modules
// rather than at next-intl's default ./i18n/request.ts, so the path is named.
const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

// Routes that are NOT documents: a PWA manifest and a generated PNG. Google
// crawls both -- it finds them through `<link rel="manifest">` and
// `og:image` -- and then files them under "Crawled, currently not indexed",
// which is the bucket that means "we judged this not worth indexing" rather
// than "you told us not to". Saying so explicitly is the honest version, and it
// keeps that bucket meaning what it should: pages with a quality problem.
//
// Safe on both. Browsers ignore `X-Robots-Tag` when installing a PWA, and the
// social scrapers that matter for an OG card (Facebook, X, LinkedIn, Slack,
// Discord) do not consult robots directives at all -- they fetch the URL named
// in the tag. The one thing it gives up is the card appearing in Google Images,
// which is not somewhere a generic branded card earns anything.
const NON_DOCUMENT_ROUTES = [
  "/manifest.webmanifest",
  // One per locale: the card is app/[locale]/opengraph-image.tsx, so it answers
  // at /opengraph-image and /es/opengraph-image alike.
  ...LOCALES.map((locale) => localePath(locale, "/opengraph-image")),
];

// Every route that renders with next/og reads exactly these three, so the list
// is shared rather than copied per route -- a fourth weight added to
// lib/seo/ogFonts.ts has one place to be added here.
const OG_FONT_FILES = [
  "./app/fonts/Geist-Regular.ttf",
  "./app/fonts/Geist-Bold.ttf",
  "./app/fonts/GeistMono-Bold.ttf",
];

const nextConfig: NextConfig = {
  // Satori (next/og) reads the OG card's fonts with `readFile` at request time
  // -- see lib/seo/ogFonts.ts. Next's tracing follows static imports, so a path
  // assembled at runtime is invisible to it and the three .ttf files would be
  // left out of the serverless bundle: the card renders locally and 500s in
  // production, which is the worst place to find out. Naming them here is what
  // puts them in the bundle. Add a weight to ogFonts.ts, add it here too.
  outputFileTracingIncludes: {
    // Under `[locale]` since Pass 7, so the brackets need the same escaping the
    // recap route below already documents -- unescaped, `[locale]` is a
    // character class and the key matches nothing.
    "/\\[locale\\]/opengraph-image": OG_FONT_FILES,
    // The daily recap card (app/api/recap/[date]/image/route.tsx), same fonts,
    // same reason. These keys are GLOB patterns matched against route paths, so
    // the brackets of a dynamic segment have to be escaped -- unescaped,
    // `[date]` is a character class matching one of d/a/t/e, the key matches
    // nothing, the fonts are never traced, and the route 500s in production
    // while working perfectly here.
    "/api/recap/\\[date\\]/image": OG_FONT_FILES,
  },

  // `/daily` -> `/` (roadmap Pass 5), as a real 308 issued by the router.
  //
  // THIS USED TO BE A PAGE AND THE PAGE DID NOT WORK.
  // `app/[locale]/(game)/daily/page.tsx` called `permanentRedirect()`, which is
  // the documented way to do this and is correct in isolation. It is not correct
  // HERE, because that route sits under the `(game)` layout -- the top bar, the
  // ad slot, four marketing sections and an async `NewsSection`. React streams
  // that shell as it renders, so by the time the page component threw its
  // redirect the response had already begun, and a status code cannot be changed
  // after the first byte. Next's fallback is to emit `<meta
  // http-equiv="refresh">` into the body and finish the response as **200 OK**.
  //
  // Measured against production on 2026-08-17: `/daily` returned 200 with 128 KB
  // of the game shell, no `<link rel="canonical">` (the page never got to export
  // metadata, so it inherited the root layout's), and `robots: index, follow`.
  // Google indexed it as a full page and reported it under "Duplicate without
  // user-selected canonical" -- an accurate description of what was being served.
  //
  // A config redirect cannot have this bug, because nothing renders. It is step 2
  // of Next's routing order (headers -> redirects -> middleware -> filesystem),
  // so it answers before next-intl's rewrite and before React is involved at all.
  //
  // One entry per locale rather than one `/:locale/daily` pattern: that pattern
  // also matches `/anything/daily` and would 308 it to a 404. The locale must be
  // carried through -- `/es/daily` landing on the English home page is a redirect
  // that silently un-translates the site for exactly the inbound traffic this
  // route exists to keep.
  async redirects() {
    return LOCALES.map((locale) => ({
      source: localePath(locale, "/daily"),
      destination: localePath(locale, "/"),
      // 308, not 307. A temporary redirect tells a crawler the move may be
      // undone and leaves the old URL holding its own identity, which is the
      // whole thing this is trying to hand over.
      permanent: true,
    }));
  },

  async headers() {
    return NON_DOCUMENT_ROUTES.map((source) => ({
      source,
      headers: [{ key: "X-Robots-Tag", value: "noindex" }],
    }));
  },
};

export default withNextIntl(nextConfig);
