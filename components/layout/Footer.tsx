import { useTranslations } from "next-intl";

import { Link } from "@/lib/i18n/navigation";


// REAL PROFILES ONLY. These were four icons pointing at `href="#"` -- a row put
// in place before any account existed to link to -- and on 2026-08-12 that was
// identified as a live policy problem rather than a loose end: AdSense rejected
// the site citing "links to content that does not exist", and the footer renders
// on EVERY page in both route groups, so four dead links were on every URL a
// reviewer or a crawler could open.
//
// The rule this row now follows: a platform appears here when its profile
// exists, and is deleted otherwise. Never `#`, never a placeholder. Discord was
// removed under exactly that rule rather than left pointing at nothing; add it
// back with a real invite URL.
//
// The TikTok URL is the bare profile, deliberately. The address the app's own
// share sheet produces carries `?is_from_webapp=1&sender_device=pc`, which is
// analytics about how the link was copied -- it works, but it is someone else's
// tracking on our page, and it makes the canonical profile URL look like a
// referral.
const SOCIAL_LINKS: { label: string; href: string; icon: React.ReactNode }[] = [
  {
    label: "TikTok",
    href: "https://www.tiktok.com/@driverpit_inc",
    icon: (
      <path d="M16.5 3c.3 2.1 1.7 3.8 3.8 4.2v2.6c-1.4 0-2.7-.4-3.8-1.2v6.7a5.7 5.7 0 1 1-5.7-5.7c.3 0 .6 0 .9.1v2.7a3 3 0 1 0 2.1 2.9V3h2.7Z" />
    ),
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/driverpit.inc",
    icon: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth={1.75} />
        <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth={1.75} />
        <circle cx="17.2" cy="6.8" r="1.1" />
      </>
    ),
  },
  {
    // Official mark (via Simple Icons) -- the previous hand-approximated
    // path had coordinates that fell outside the 0-24 viewBox, which SVG
    // clips by default, so part of the glyph was silently cut off.
    label: "X",
    href: "https://x.com/driverpit_inc",
    icon: (
      <path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z" />
    ),
  },
  // Discord was the fourth entry and is deleted rather than left at `#` -- there
  // is no server yet. Its Simple Icons path is in git history if one is created.
];

// Paths stay UNPREFIXED and the label is a message key, not a string: `Link`
// here is lib/i18n/navigation's, which adds the current locale's prefix at
// render time. It used to be `next/link` with English labels, which meant every
// footer link on a Spanish page walked the reader back to the English site --
// silently, because the page it landed on was a real page.
const INFO_LINKS = [
  // The footer is on every page in both route groups, which makes it the one
  // place that gives the archive index a site-wide inbound link. Without it the
  // index is reachable only from the sitemap and from a finished daily board,
  // and an index nobody links to cannot do the job it exists for.
  { href: "/archive", key: "archive" },
  { href: "/about", key: "about" },
  { href: "/faq", key: "faq" },
  { href: "/game-modes", key: "gameModes" },
  { href: "/how-to-play", key: "howToPlay" },
  { href: "/strategy", key: "strategy" },
  // Contact is footer-only, deliberately -- it is not one of the pages someone
  // browses between, it is the one they look for when something has gone wrong,
  // and the footer is where every site puts it. It renders on every page in both
  // route groups, which is also what makes the address reachable from anywhere
  // in one scroll: the thing an AdSense reviewer checks for.
  { href: "/contact", key: "contact" },
  { href: "/privacy-policy", key: "privacy" },
  { href: "/terms-of-service", key: "terms" },
] as const;

export function Footer() {
  const t = useTranslations("nav");

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-240 flex-col items-center gap-4 px-4 py-6">
        <div className="flex items-center gap-2">
          {SOCIAL_LINKS.map((social) => (
            <a
              key={social.label}
              href={social.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={social.label}
              className="rounded-lg p-2 text-text-muted transition hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-4.5 w-4.5" aria-hidden="true">
                {social.icon}
              </svg>
            </a>
          ))}
        </div>

        <nav aria-label={t("infoPages")} className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          {INFO_LINKS.map((link, index) => (
            <span key={link.href} className="flex items-center gap-2">
              {index > 0 && (
                <span className="text-text-muted" aria-hidden="true">
                  ·
                </span>
              )}
              <Link href={link.href} className="text-xs text-text-muted transition hover:text-text">
                {t(`links.${link.key}`)}
              </Link>
            </span>
          ))}
        </nav>

        <p className="text-center text-xs text-text-muted">
          {/* A string, not a number: a bare `{year}` placeholder is formatted by
              the locale, and 2026 renders as "2,026" in English and "2.026" in
              four of the other five. Same trap the driver page's `debut` documents. */}
          {t("disclaimer", { year: String(new Date().getFullYear()) })}
        </p>
      </div>
    </footer>
  );
}
