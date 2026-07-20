"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/about", label: "About" },
  { href: "/faq", label: "FAQ" },
  { href: "/game-modes", label: "Game modes" },
  { href: "/how-to-play", label: "How to play" },
];

// TopBar's counterpart for the info pages -- same header shell (logo,
// border-b, max-w-240 container) but the settings/leaderboard icon buttons
// are swapped for text nav between the info pages plus a "Play now" CTA
// back into the game shell, since neither settings nor a leaderboard exist
// outside it. Logo pinned left; the nav's `ml-auto` pushes it and "Play
// now" together as one group against the right edge. The nav itself is the
// only part that can shrink/scroll (`min-w-0 overflow-x-auto` -- min-w-0 is
// load-bearing, a flex item defaults to min-width: auto and won't actually
// shrink below its content without it), so "Play now" always stays fully
// visible and everything stays on one line on a narrow phone.
export function InfoTopBar() {
  const pathname = usePathname();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-240 items-center gap-2 px-4 py-3">
        <Link
          href="/daily"
          className="flex shrink-0 items-center text-2xl font-bold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span>DRIVER</span>
          <span className="text-accent">PIT</span>
        </Link>

        <nav aria-label="Info pages" className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
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
