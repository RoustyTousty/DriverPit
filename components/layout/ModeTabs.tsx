"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/daily", label: "Daily" },
  { href: "/infinite", label: "Infinite" },
  { href: "/duel", label: "Duel" },
];

// Same segmented-pill look as the Settings/Leaderboard modal tablists
// (rounded-lg border bg-surface-2 p-1 container, bg-accent-weak/text-accent
// active state) for visual consistency across every tab switcher in the
// app, not just the ones inside modals.
export function ModeTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Game mode" className="flex justify-center px-4 pt-3 pb-2">
      <div role="tablist" className="flex w-full max-w-sm gap-1 rounded-lg border border-border bg-surface-2 p-1">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname?.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              className={`flex-1 rounded-md px-3 py-1.5 text-center text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                active ? "bg-accent-weak text-accent" : "text-text-muted hover:text-text"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
