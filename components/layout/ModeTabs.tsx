"use client";


import { prefetchInfiniteRound } from "@/lib/game/infiniteRoundPrefetch";
import { readDriverFilterPreference } from "@/lib/settings/driverFilter";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/lib/i18n/navigation";

const TABS = [
  // Daily is `/` -- the game is served at the root (roadmap Pass 5), and /daily
  // is now a 308 into here. Linking at the redirect would make every mode
  // switch pay a hop.
  { href: "/", key: "daily" },
  { href: "/infinite", key: "infinite" },
  { href: "/online", key: "online" },
];

// Exact match for the root, prefix match for the rest -- and the split is the
// whole point. Every route on the site is "under" `/`, so any prefix test
// applied to it lights up Daily on /infinite and /online as well, leaving two
// tabs active at once and two `aria-selected="true"` in one tablist. The prefix
// arm exists for a future nested route (`/online/...`), which is why it is kept
// rather than collapsed into equality everywhere.
function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Hovering/focusing Infinite is a strong signal the user is about to
// switch there -- start its per-visit driver pick now instead of waiting
// for InfiniteGame to mount and request it, so that round trip's latency
// overlaps with the user's own dwell time rather than adding to it. See
// lib/game/infiniteRoundPrefetch.ts.
function handleInfiniteIntent() {
  prefetchInfiniteRound(readDriverFilterPreference("infinite", new Date().getUTCFullYear()));
}

// Same segmented-pill look as the Settings/Leaderboard modal tablists
// (rounded-lg border bg-surface-2 p-1 container, bg-accent-weak/text-accent
// active state) for visual consistency across every tab switcher in the
// app, not just the ones inside modals.
export function ModeTabs() {
  const t = useTranslations("nav.modes");
  const pathname = usePathname();

  return (
    <nav aria-label={t("label")} className="flex justify-center px-4">
      <div role="tablist" className="flex w-full max-w-sm gap-1 rounded-lg border border-border bg-surface-2 p-1">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              onPointerEnter={tab.href === "/infinite" ? handleInfiniteIntent : undefined}
              onFocus={tab.href === "/infinite" ? handleInfiniteIntent : undefined}
              className={`flex-1 rounded-md px-3 py-1.5 text-center text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                active ? "bg-accent-weak text-accent" : "text-text-muted hover:text-text"
              }`}
            >
              {t(tab.key)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
