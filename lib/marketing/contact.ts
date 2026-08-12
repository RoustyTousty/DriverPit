// How to reach the person who runs this site, in one place.
//
// It is a module rather than a string in a component because more than one page
// wants it and they must not disagree: /contact renders it, the privacy policy
// and terms both promise a way to raise a question or a data request, and an
// address that is right on one page and stale on another is worse than one that
// is simply missing -- the reader who used the stale one thinks they contacted
// somebody.
//
// WHY THIS PAGE EXISTS AT ALL. There was no contact route before 2026-08-12.
// AdSense rejected the site under "low value content", and a reachable owner is
// one of the things a reviewer looks for when deciding whether a site is a real
// publication or a thin generated one -- alongside the privacy policy and terms
// this site already had. It is also the honest counterpart to those two: a
// privacy policy that describes a data-deletion right with no way to exercise it
// is a promise with no mechanism behind it.
//
// NOT IN THE MESSAGE CATALOGUES. An address is not prose, and
// `npm run i18n:translate` rewrites what it is given -- a model asked to
// translate a page containing an email has no reason to leave the local part
// alone, and "driverpit.inc" is exactly the kind of token that gets helpfully
// localised. The labels around it are translated; the address itself is a
// constant here, interpolated in.

/** The one address. Reached by /contact and by both legal pages. */
export const CONTACT_EMAIL = "driverpit.inc@gmail.com";

/**
 * `mailto:` for the address above.
 *
 * A function rather than a second constant, so the two can never spell the
 * address differently -- which is a real failure mode, because a wrong `mailto:`
 * looks identical to a right one until somebody clicks it.
 */
export function contactMailto(subject?: string): string {
  const base = `mailto:${CONTACT_EMAIL}`;
  return subject ? `${base}?subject=${encodeURIComponent(subject)}` : base;
}

/**
 * The public profiles, in the order the contact page lists them.
 *
 * Shares no code with the footer's `SOCIAL_LINKS`, which carries SVG paths and
 * is icon-only; what is duplicated is three URLs, and merging the two would mean
 * either dragging icon markup into a lib module or dragging this ordering into a
 * layout component. Both are worse than the duplication. The rule that matters
 * is the same in both places and is written out in the footer: a platform is
 * listed when its profile exists, and deleted otherwise -- never `#`.
 */
export const SOCIAL_PROFILES: readonly { label: string; handle: string; href: string }[] = [
  { label: "X", handle: "@driverpit_inc", href: "https://x.com/driverpit_inc" },
  { label: "Instagram", handle: "@driverpit.inc", href: "https://www.instagram.com/driverpit.inc" },
  { label: "TikTok", handle: "@driverpit_inc", href: "https://www.tiktok.com/@driverpit_inc" },
];
