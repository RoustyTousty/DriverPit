// The locale set, in one place, because five things have to agree about it: the
// routing config, the middleware, `buildPageMetadata`'s hreflang block, the
// sitemap and the language switcher. A second copy of this list is how a locale
// ends up served but not advertised, or advertised but not served -- both of
// which are silent.
//
// Pure and free of any next-intl import on purpose: this is imported by client
// components (the switcher) and by server-only modules (the sitemap), and it
// must not drag a runtime into either.

/**
 * BCP-47 language tags, and they are the tags that go in `hreflang`. Ordered
 * with the default first, then by the size of the F1 audience each reaches --
 * which is also the order the language switcher renders.
 */
export const LOCALES = ["en", "es", "pt", "it", "nl", "de"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/**
 * URL prefix per locale, kept as an explicit map rather than derived from the
 * tag. An unrecognised prefix is NOT a 404 under "as-needed" -- it is just a
 * path, so it would serve the English page at a second URL and quietly
 * duplicate every page on the site. Deriving the prefix would make that failure
 * one typo away; a map makes it unrepresentable.
 *
 * The default locale has no prefix at all (`localePrefix: "as-needed"`), which
 * is what keeps `/`, `/faq` and every already-indexed URL exactly where Pass 5
 * put them.
 */
export const LOCALE_PREFIXES: Record<Locale, string> = {
  en: "/",
  es: "/es",
  pt: "/pt",
  it: "/it",
  nl: "/nl",
  de: "/de",
};

/**
 * What the language switcher shows. Each locale is named in ITS OWN language --
 * a Dutch speaker looks for "Nederlands", not for "Dutch" -- which is the whole
 * convention for a language picker and the reason these are not translated
 * strings in the message catalogues.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  pt: "Português",
  it: "Italiano",
  nl: "Nederlands",
  de: "Deutsch",
};

/**
 * The `og:locale` value per locale -- underscored territory, which is Facebook's
 * format rather than BCP-47's. `og:locale` requires `language_TERRITORY`, so a
 * bare "es" is invalid and is dropped. Portuguese is the one that is not a
 * mechanical transformation: it routes as `pt` (serving every Portuguese
 * market) but declares `pt_BR`, because the copy is Brazilian.
 */
export const OG_LOCALES: Record<Locale, string> = {
  en: "en_US",
  es: "es_ES",
  pt: "pt_BR",
  it: "it_IT",
  nl: "nl_NL",
  de: "de_DE",
};

/**
 * The tag to hand `Intl`, which is NOT always the tag we route on.
 *
 * Two entries differ. `en` because `Intl` reads a bare "en" as American
 * English: `DateTimeFormat` renders "August 7, 2026"
 * instead of "7 August 2026", and `ListFormat` inserts an Oxford comma
 * ("McLaren, Mercedes, and Ferrari"). This site's own English is British — the
 * copy says "colour" — so those two were the only places the prose contradicted
 * itself, and they did it on the archive and driver pages, side by side with a
 * date formatted the other way by `formatRecapDate`.
 *
 * And `pt`, which formats as `pt-BR` to match the Brazilian copy while routing
 * and advertising as plain `pt`.
 *
 * `hreflang` keeps the routing tag, not this one: we are not claiming to serve
 * a UK-targeted page, only formatting numbers and dates the way the copy reads.
 */
const INTL_LOCALES: Record<Locale, string> = {
  en: "en-GB",
  es: "es",
  pt: "pt-BR",
  it: "it",
  nl: "nl",
  de: "de",
};

export function intlLocale(locale: Locale): string {
  return INTL_LOCALES[locale];
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Site-relative path for `path` in `locale`. `path` is always the *unprefixed*
 * internal path ("/faq", "/"), which is how every caller in this repo stores a
 * route -- the sitemap's `ROUTES`, `buildPageMetadata`'s `path`, the footer's
 * link list. Returns a path, never an absolute URL; `absoluteUrl` is what turns
 * it into one, and keeping those two steps separate is what stops a canonical
 * being built out of an origin twice.
 */
export function localePath(locale: Locale, path: string): string {
  const clean = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  const prefix = LOCALE_PREFIXES[locale];
  if (prefix === "/") return clean === "" ? "/" : clean;
  return `${prefix}${clean}`;
}
