"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/daily", label: "Daily" },
  { href: "/infinite", label: "Infinite" },
  { href: "/duel", label: "Duel" },
];

export function ModeTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Game mode" className="border-b border-border">
      <div className="mx-auto flex w-full max-w-[960px] justify-center gap-1 px-4 py-2">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname?.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                active
                  ? "bg-accent-weak text-accent"
                  : "text-text-muted hover:bg-surface-2 hover:text-text"
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
