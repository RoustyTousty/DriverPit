"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { readSettings, writeSettings, type Settings } from "@/lib/settings/store";
import { resetUserStats } from "@/lib/stats/actions";

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  preview,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  preview?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-text">{label}</p>
        <p className="text-xs text-text-muted">{description}</p>
        {preview}
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
        {/* Explicit left-0.5 anchor + translate-x-0/5.5 (not translate alone
            from an implicit static position) -- track is 44px, thumb 18px,
            so the "on" resting spot is 44 - 18 - 2*2px inset = 22px away
            from the "off" spot. Getting this from an unanchored translate
            undershot by 2px and left the thumb visibly short of the right
            edge when on. */}
        <span
          className={`absolute top-0.5 left-0.5 h-4.5 w-4.5 rounded-full bg-white transition-transform motion-reduce:transition-none ${
            checked ? "translate-x-5.5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

// Miniature live preview of the three tile colors this toggle affects --
// updates instantly as the switch flips (mirrors the CSS values in
// globals.css) so the effect is shown, not just described. Values duplicated
// here rather than read from computed styles: this renders inline with the
// toggle before the setting is applied to <html>, so it can't depend on the
// DOM attribute the CSS keys off of.
function ColorblindPreview({ colorblind }: { colorblind: boolean }) {
  const correct = colorblind ? "#3b82f6" : "#2e7d46";
  const miss = "#2a2f37";
  const accent = "#ff6a00";
  const closenessOpacity = Math.min(1, 0.5 + (colorblind ? 0.18 : 0));

  const swatches: { label: string; node: React.ReactNode }[] = [
    { label: "Correct", node: <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: correct }} /> },
    {
      label: "Close",
      node: (
        <div className="relative h-2.5 w-2.5 overflow-hidden rounded-full" style={{ backgroundColor: miss }}>
          <div className="absolute inset-0" style={{ backgroundColor: accent, opacity: closenessOpacity }} />
        </div>
      ),
    },
    { label: "Miss", node: <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: miss }} /> },
  ];

  return (
    <div className="mt-1.5 flex items-center gap-1" aria-hidden="true">
      {swatches.map((swatch) => (
        <div key={swatch.label}>{swatch.node}</div>
      ))}
    </div>
  );
}

export function GeneralSection() {
  const { refresh } = useAuth();
  const [settings, setSettings] = useState<Settings>(() => readSettings());
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
        label="Show flags"
        description="Nationality tiles show a flag instead of the country name."
        checked={settings.showFlags}
        onChange={(next) => update({ showFlags: next })}
      />

      <ToggleRow
        label="Reduce motion"
        description="Turn off tile flips and button animations, regardless of your system setting."
        checked={settings.reducedMotion}
        onChange={(next) => update({ reducedMotion: next })}
      />

      <ToggleRow
        label="Colorblind mode"
        description="Swaps the correct-tile green for a blue that stays distinct from the orange accent, and boosts near-miss tint contrast."
        checked={settings.colorblindMode}
        onChange={(next) => update({ colorblindMode: next })}
        preview={<ColorblindPreview colorblind={settings.colorblindMode} />}
      />

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
