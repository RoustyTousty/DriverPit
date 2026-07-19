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
// outside it.
export function InfoTopBar() {
  const pathname = usePathname();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-240 flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link
          href="/daily"
          className="flex items-center text-lg font-bold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span>Driver</span>
          <span className="text-accent">Pit</span>
        </Link>

        <nav aria-label="Info pages" className="flex flex-wrap items-center gap-1">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  active ? "bg-surface-2 text-text" : "text-text-muted hover:bg-surface-2 hover:text-text"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <Link
            href="/daily"
            className="ml-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Play now
          </Link>
        </nav>
      </div>
    </header>
  );
}
