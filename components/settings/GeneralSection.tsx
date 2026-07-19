"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { POOL_WINDOWS, type PoolWindow } from "@/lib/game/poolWindow";
import { readPoolWindowPreference, writePoolWindowPreference } from "@/lib/settings/poolWindow";
import { readSettings, writeSettings, type Settings } from "@/lib/settings/store";
import { resetUserStats } from "@/lib/stats/actions";

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-text">{label}</p>
        <p className="text-xs text-text-muted">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          checked ? "border-accent bg-accent" : "border-border bg-surface-2"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white transition-transform motion-reduce:transition-none ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export function GeneralSection() {
  const { refresh } = useAuth();
  const [settings, setSettings] = useState<Settings>(() => readSettings());
  const [poolWindow, setPoolWindow] = useState<PoolWindow>(() => readPoolWindowPreference());
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    if (!confirmingReset) return;
    const timeout = setTimeout(() => setConfirmingReset(false), 4000);
    return () => clearTimeout(timeout);
  }, [confirmingReset]);

  function update(partial: Partial<Settings>) {
    const next = { ...settings, ...partial };
    setSettings(next);
    writeSettings(next);
  }

  function handlePoolChange(next: PoolWindow) {
    setPoolWindow(next);
    writePoolWindowPreference(next);
  }

  async function handleResetClick() {
    if (!confirmingReset) {
      setConfirmingReset(true);
      return;
    }
    await resetUserStats();
    await refresh();
    setConfirmingReset(false);
    setResetDone(true);
  }

  return (
    <div className="flex flex-col gap-5">
      <ToggleRow
        label="Hard mode"
        description="Any revealed constraints must be carried into later guesses."
        checked={settings.hardMode}
        onChange={(next) => update({ hardMode: next })}
      />

      <ToggleRow
        label="Reduce motion"
        description="Turn off tile flips and button animations, regardless of your system setting."
        checked={settings.reducedMotion}
        onChange={(next) => update({ reducedMotion: next })}
      />

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-sm font-semibold text-text">Default Infinite pool</p>
        <p className="text-xs text-text-muted">Which drivers Infinite mode draws from by default.</p>
        <div className="flex flex-col gap-1.5">
          {POOL_WINDOWS.map((window) => {
            const isSelected = window.value === poolWindow;
            return (
              <button
                key={window.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => handlePoolChange(window.value)}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  isSelected
                    ? "border-accent bg-accent-weak text-accent"
                    : "border-border text-text hover:bg-surface-2"
                }`}
              >
                <span className="font-semibold">{window.tier}</span>
                <span className={isSelected ? "text-accent/70" : "text-text-muted"}>{window.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1 border-t border-border pt-4">
        <p className="text-sm font-semibold text-text">Daily reset</p>
        <p className="text-xs text-text-muted">
          A new daily driver is chosen at 00:00 UTC. The countdown shown after you finish converts
          that to your local time.
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-sm font-semibold text-text">Stats</p>
        <p className="text-xs text-text-muted">
          Clears games played, streaks, and guess distribution for this account.
        </p>
        <button
          type="button"
          onClick={() => void handleResetClick()}
          className={`self-start rounded-lg border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            confirmingReset
              ? "border-red-400/50 bg-red-400/10 text-red-400"
              : "border-border text-text-muted hover:bg-surface-2 hover:text-text"
          }`}
        >
          {resetDone ? "Stats reset" : confirmingReset ? "Click again to confirm" : "Reset stats"}
        </button>
      </div>
    </div>
  );
}
