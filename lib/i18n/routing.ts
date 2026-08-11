import { defineRouting } from "next-intl/routing";

import { DEFAULT_LOCALE, LOCALES, LOCALE_PREFIXES } from "./locales";

// Three settings here are decisions rather than defaults, and each one has a
// reason that is not obvious from the value.
//
// `localePrefix: "as-needed"` -- English keeps every URL it already has. `/`
// stays the daily game (Pass 5 moved it there specifically to stop spending a
// redirect on the most-linked URL the site has), `/faq` stays `/faq`, and every
// indexed archive and driver page keeps its address. Only the five added
// locales get a prefix. `"always"` would have redirected `/` to `/en` and
// undone Pass 5 on the first request.
//
// `localeDetection: false` -- the URL is the only thing that decides the
// locale. No `accept-language` sniffing, no cookie. This is the SEO-correct
// choice and it is deliberate: an automatic redirect off `/` means a crawler,
// a shared link and a person with a Spanish browser can all end up somewhere
// other than the URL that was linked, Google's own guidance warns that it stops
// some versions being discovered at all, and it would put a redirect back on
// the bare domain that Pass 5 just removed. Discovery happens through hreflang
// for crawlers and the footer's language switcher for people.
//
// `localeCookie: false` -- follows from the line above. With detection off the
// cookie is never read, so writing one would be a `Set-Cookie` on every
// document request that nothing consumes, plus a needless `Vary` surface on a
// site that leans on ISR.
//
// `alternateLinks: false` -- next-intl can emit the hreflang set as a `Link:`
// response header. We emit it in the HTML instead, from `buildPageMetadata`,
// because that is the only place that knows the things the middleware cannot:
// which pages are `noindex` (the two `/auth` pages must not advertise
// alternates), and what a dynamic archive or driver path actually is. Two
// emitters would be two answers to the same question.
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: {
    mode: "as-needed",
    // The default locale's entry is omitted: "as-needed" means it has no
    // prefix, and naming one for it would be contradictory.
    prefixes: Object.fromEntries(
      Object.entries(LOCALE_PREFIXES).filter(([, prefix]) => prefix !== "/"),
    ),
  },
  localeDetection: false,
  localeCookie: false,
  alternateLinks: false,
});
