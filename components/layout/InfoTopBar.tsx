"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import driverpitBanner from "@/public/driverpit-banner.png";

const LINKS = [
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/game-modes", label: "Game modes" },
  { href: "/how-to-play", label: "How to play" },
];

// aria-controls target for the collapsed nav's disclosure button.
const MENU_ID = "info-nav-menu";

// TopBar's counterpart for the info pages -- same header shell (logo,
// border-b, max-w-240 container) but the settings/leaderboard icon buttons
// are swapped for nav between the info pages plus a "Play now" CTA back
// into the game shell, since neither settings nor a leaderboard exist
// outside it. Logo pinned left; the nav group's `ml-auto` pushes it and
// "Play now" together as one group against the right edge.
//
// The four info links only fit as an inline row down to ~sm; below that
// they'd either get clipped behind "Play now" or force a barely-discoverable
// horizontal scroll strip, so under sm they collapse into a single dropdown
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
// a combobox, while this picks a PAGE and is four links. As a plain disclosure
// (aria-expanded + aria-controls over a <ul> of <Link>s) every promise it makes
// is one the browser keeps for free -- Tab reaches each link, Enter follows it,
// Escape closes.
export function InfoTopBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeLink = LINKS.find((link) => link.href === pathname) ?? LINKS[0];

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
          href="/daily"
          className="flex shrink-0 items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Image src={driverpitBanner} alt="DriverPit" priority className="h-7 w-auto" />
        </Link>

        <nav aria-label="Info pages" className="ml-auto hidden items-center gap-1 sm:flex">
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
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="relative ml-auto sm:hidden" ref={containerRef}>
          <button
            type="button"
            ref={triggerRef}
            aria-expanded={open}
            aria-controls={MENU_ID}
            aria-label="Info pages"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-left text-sm font-semibold text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent"
          >
            {activeLink.label}
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
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Link
          href="/daily"
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Play now
        </Link>
      </div>
    </header>
  );
}
