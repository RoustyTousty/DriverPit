import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE, type Locale } from "./locales";
import { routing } from "./routing";

// Loads the message catalogue for the request's locale.
//
// The `hasLocale` guard is not defensive padding: `[locale]` is a dynamic
// segment, so a request for `/xx/faq` reaches this with `locale === "xx"`, and
// without the check the dynamic import below would throw a module-not-found
// inside a Server Component -- a 500 where a 404 is the honest answer. Falling
// back to the default locale rather than throwing keeps the segment renderable;
// the page's own `notFound()` (see app/[locale]/layout.tsx) is what turns an
// unknown locale into a 404.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = hasLocale(routing.locales, requested) ? requested : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // Both are pinned rather than left to the runtime's defaults, because the
    // default is the SERVER's timezone and the SERVER's clock -- which on Vercel
    // is UTC in production and this machine's local zone in development, so a
    // formatted date could differ between the two for no reason a reader could
    // see. UTC is also the only correct answer here: the puzzle turns over at
    // midnight UTC, and every date this site renders is a puzzle date.
    timeZone: "UTC",
    now: new Date(),
  };
});
