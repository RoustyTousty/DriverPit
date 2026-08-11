import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

// The request config lives under lib/ with the rest of this repo's modules
// rather than at next-intl's default ./i18n/request.ts, so the path is named.
const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

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
};

export default withNextIntl(nextConfig);
