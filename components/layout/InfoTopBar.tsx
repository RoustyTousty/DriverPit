"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import driverpitBanner from "@/public/driverpit-banner.png";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/lib/i18n/navigation";

// Paths unprefixed, labels as message keys -- `nav.links.*`, the same set the
// footer reads, so the two navs cannot drift into different words for the same
// page in the same language.
const LINKS = [
  { href: "/about", key: "about" },
  { href: "/faq", key: "faq" },
  { href: "/game-modes", key: "gameModes" },
  { href: "/how-to-play", key: "howToPlay" },
  // The strategy guide sits next to How to play because that is the pair: one
  // is the rules, the other is what to do with them, and a reader who finishes
  // the first wants the second. Contact is NOT here -- it lives in the footer,
  // where people look for it, and a fifth nav item earns its place by being
  // something you browse to rather than something you need.
  { href: "/strategy", key: "strategy" },
] as const;

// aria-controls target for the collapsed nav's disclosure button.
const MENU_ID = "info-nav-menu";

// TopBar's counterpart for the info pages -- same header shell (logo,
// border-b, max-w-240 container) but the settings/leaderboard icon buttons
// are swapped for nav between the info pages plus a "Play now" CTA back
// into the game shell, since neither settings nor a leaderboard exist
// outside it. Logo pinned left; the nav group's `ml-auto` pushes it and
// "Play now" together as one group against the right edge.
//
// The info links only fit as an inline row down to ~md; below that they'd
// either get clipped behind "Play now" or force a barely-discoverable
// horizontal scroll strip, so under md they collapse into a single dropdown
// button labelled with the current page instead -- borrowing PoolSelect's
// *visual* language (same trigger chrome, same borderless no-animation panel,
// same accent-weak current row) rather than inventing a second one.
//
// It borrows the look and NOT the roles. It used to carry PoolSelect's
// role="combobox"/listbox/option markup as well, with none of the keyboard
// model those roles promise -- no onKeyDown, no roving tabIndex, no
// aria-activedescendant -- so a screen reader announced a listbox and then
// arrow keys did nothing (audit 2026-07-30 §4.5). The fix is to drop the
// roles, not to implement the handlers: PoolSelect picks a VALUE and has to be
// a combobox, while this picks a PAGE and is a handful of links. As a plain
// disclosure (aria-expanded + aria-controls over a <ul> of <Link>s) every
// promise it makes is one the browser keeps for free -- Tab reaches each link,
// Enter follows it, Escape closes.
//
// THE BREAKPOINT MOVED FROM sm TO md when the strategy guide was added
// (2026-08-12). Five links plus the logo and the "Play now" CTA overflow a
// 640px viewport, and that failure is quiet rather than loud: the row does not
// wrap, it pushes the CTA past the edge. If a sixth link is ever proposed here,
// measure it -- or send it to the footer, which is where /contact went for
// exactly this reason.
export function InfoTopBar() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Null, not LINKS[0], when the current route is not one of the four. The
  // fallback was harmless while (info) held exactly these pages; the archive
  // lives in the same group and is not in this nav, so it would have labelled
  // the collapsed trigger "About" on every one of those pages.
  const activeLink = LINKS.find((link) => link.href === pathname) ?? null;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // The panel unmounts on close, so closing while focus is on one of the
      // links drops it to <body> and the next Tab restarts from the top of the
      // document. Same rule as the rest of the site (CLAUDE.md, "Design
      // system"): when a control disappears under the player, whatever
      // replaces it takes focus -- here the trigger the panel came out of.
      if (containerRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
      setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-240 items-center gap-2 px-4 py-3">
        <Link
          href="/"
          className="flex shrink-0 items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Image src={driverpitBanner} alt={t("logoAlt")} priority className="h-7 w-auto" />
        </Link>

        <nav aria-label={t("infoPages")} className="ml-auto hidden items-center gap-1 md:flex">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  active ? "bg-surface-2 text-text" : "text-text-muted hover:bg-surface-2 hover:text-text"
                }`}
              >
                {t(`links.${link.key}`)}
              </Link>
            );
          })}
        </nav>

        <div className="relative ml-auto md:hidden" ref={containerRef}>
          <button
            type="button"
            ref={triggerRef}
            aria-expanded={open}
            aria-controls={MENU_ID}
            aria-label={t("infoPages")}
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-left text-sm font-semibold text-text outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
          >
            {activeLink ? t(`links.${activeLink.key}`) : t("menu")}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              className={`h-4 w-4 shrink-0 text-text-muted transition-transform duration-200 motion-reduce:transition-none ${
                open ? "rotate-180" : ""
              }`}
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {open && (
            <ul
              id={MENU_ID}
              className="absolute top-full right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
            >
              {LINKS.map((link) => {
                const active = pathname === link.href;
                return (
                  <li key={link.href}>
                    {/* aria-current="page", not the aria-selected an option
                        would have carried -- these are links to pages, and it
                        is the same attribute the wide-viewport nav above
                        already uses for the same state. */}
                    <Link
                      href={link.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={`block px-4 py-3 text-sm transition ${
                        active ? "bg-accent-weak font-semibold text-accent" : "text-text hover:bg-surface-2"
                      }`}
                    >
                      {t(`links.${link.key}`)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Link
          href="/"
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {t("playNow")}
        </Link>
      </div>
    </header>
  );
}
