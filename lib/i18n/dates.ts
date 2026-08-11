import { intlLocale, type Locale } from "./locales";

// Dates that appear in HTML, formatted by the reader's locale.
//
// This is deliberately NOT `lib/recap/format.ts`'s `formatRecapDate`, and the
// two must not be merged. That one is locale-independent on purpose: it feeds
// the Satori recap card, where the same finished day has to produce the same
// bytes on every request from any server. This one feeds pages, where "8 August
// 2026" is simply the wrong way to write that date for five of the six locales
// this site now serves.
//
// `timeZone: "UTC"` on every call, and it is not optional: every date on this
// site is a puzzle date, the puzzle turns over at midnight UTC, and formatting
// `2026-08-08T00:00:00Z` in a negative-offset zone renders it as the 7th.

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: Locale, style: "long" | "short"): Intl.DateTimeFormat {
  const key = `${locale}:${style}`;
  let found = cache.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(intlLocale(locale), {
      day: "numeric",
      month: style,
      year: "numeric",
      timeZone: "UTC",
    });
    cache.set(key, found);
  }
  return found;
}

/** `2026-07-31` → `31 July 2026` / `31 de julio de 2026` / `31. Juli 2026`. */
export function formatUtcDate(date: string, locale: Locale, style: "long" | "short" = "long"): string {
  return formatter(locale, style).format(new Date(`${date}T00:00:00.000Z`));
}
