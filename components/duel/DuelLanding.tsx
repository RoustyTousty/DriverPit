"use client";

import { useAuth } from "@/components/auth/AuthProvider";
import { useSettingsModal } from "@/components/layout/SettingsModalContext";

export function DuelLanding({ onSelectDuel }: { onSelectDuel: () => void }) {
  const { profile } = useAuth();
  const { openSettings } = useSettingsModal();

  return (
    <div className="flex flex-col gap-3 px-4 py-6">
      <header>
        <h1 className="text-xl font-bold text-text sm:text-2xl">DriverPit</h1>
        <p className="text-sm text-text-muted">Online</p>
      </header>

      {profile?.isGuest && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-accent-weak bg-accent-weak/40 p-3">
          <div>
            <p className="text-sm font-semibold text-accent">Save your progress</p>
            <p className="text-xs text-text-muted">Create an account so your stats and streak follow you across devices.</p>
          </div>
          <button
            type="button"
            onClick={() => openSettings("profile")}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition hover:brightness-110 motion-safe:active:scale-[0.98]"
          >
            Sign up
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onSelectDuel}
        className="flex flex-col items-start gap-1 rounded-lg border border-border bg-surface-2 p-4 text-left transition hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="text-base font-bold text-text">Duel</span>
        <span className="text-sm text-text-muted">
          Race a matchmade opponent across 3 rounds. Fastest correct guess wins each round.
        </span>
      </button>

      <div className="flex flex-col items-start gap-1 rounded-lg border border-border bg-surface p-4 text-left opacity-60">
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-base font-bold text-text">Knockout</span>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold tracking-wide text-text-muted uppercase">
            Coming soon
          </span>
        </div>
        <span className="text-sm text-text-muted">
          20 players, one target, F1-qualifying-style elimination over 3 rounds.
        </span>
      </div>
    </div>
  );
}
