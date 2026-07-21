"use client";

import Image from "next/image";
import Link from "next/link";

import driverpitBanner from "@/public/driverpit-banner.png";

import { useSettingsModal } from "./SettingsModalContext";

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function LeaderboardIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4a1 1 0 0 0-1 1 4 4 0 0 0 4 4M17 6h3a1 1 0 0 1 1 1 4 4 0 0 1-4 4" />
    </svg>
  );
}

const iconButtonClass =
  "rounded-lg p-2 text-text-muted transition hover:bg-surface-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// The modals themselves (and their open/close state) live in GameModals,
// the client wrapper around this whole shell -- this bar just triggers
// them, same as any other descendant (e.g. the duel results panel's guest
// upgrade prompt).
export function TopBar() {
  const { openSettings, openLeaderboard } = useSettingsModal();

  return (
    <header className="border-b border-border">
      <div className="mx-auto grid w-full max-w-[960px] grid-cols-[auto_1fr_auto] items-center gap-2 px-4 py-3">
        <button
          type="button"
          aria-label="Leaderboard"
          className={iconButtonClass}
          onClick={openLeaderboard}
        >
          <LeaderboardIcon />
        </button>

        <Link
          href="/daily"
          className="flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Image src={driverpitBanner} alt="DriverPit" priority className="h-12 w-auto" />
        </Link>

        <button
          type="button"
          aria-label="Settings"
          className={`${iconButtonClass} justify-self-end`}
          onClick={() => openSettings("general")}
        >
          <SettingsIcon />
        </button>
      </div>
    </header>
  );
}
