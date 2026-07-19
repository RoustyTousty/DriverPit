"use client";

import Link from "next/link";
import { useState } from "react";

import { LeaderboardModal } from "@/components/leaderboard/LeaderboardModal";
import { SettingsModal, type SettingsSection } from "@/components/settings/SettingsModal";

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

type OpenModal = "settings" | "leaderboard" | null;

export function TopBar() {
  const [openModal, setOpenModal] = useState<OpenModal>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-[960px] items-center justify-between px-4 py-3">
        <Link
          href="/daily"
          className="flex items-center text-lg font-bold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span>Driver</span>
          <span className="text-accent">Pit</span>
        </Link>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Settings"
            className={iconButtonClass}
            onClick={() => {
              setSettingsSection("general");
              setOpenModal("settings");
            }}
          >
            <SettingsIcon />
          </button>
          <button
            type="button"
            aria-label="Leaderboard"
            className={iconButtonClass}
            onClick={() => setOpenModal("leaderboard")}
          >
            <LeaderboardIcon />
          </button>
        </div>
      </div>

      <SettingsModal
        open={openModal === "settings"}
        onClose={() => setOpenModal(null)}
        initialSection={settingsSection}
      />
      <LeaderboardModal
        open={openModal === "leaderboard"}
        onClose={() => setOpenModal(null)}
        onUpgrade={() => {
          setSettingsSection("profile");
          setOpenModal("settings");
        }}
      />
    </header>
  );
}
