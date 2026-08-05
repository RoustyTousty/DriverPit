"use client";

import { useAuth } from "@/components/auth/AuthProvider";
import { useSettingsModal } from "@/components/layout/SettingsModalContext";

export function DuelLanding({
  onSelectDuel,
  onSelectCustom,
}: {
  onSelectDuel: () => void;
  // Optional so LoadingShell can render this screen inert without inventing a
  // second no-op handler.
  onSelectCustom?: () => void;
}) {
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
        {/* The second sentence is the rule a first-time player has to know
            BEFORE the penalty first bites, or it reads as a bug (drizzle/0058).
            Stated as what to do, not as what is forbidden -- the mechanic
            exists to make thinking pay, and framing it as an anti-cheat
            warning would put the accusation on the wrong player. */}
        <span className="text-sm text-text-muted">
          Race a matchmade opponent across 3 rounds. Solve fast to score, but guess carefully — after the
          third, every wrong guess cuts what the round is worth.
        </span>
      </button>

      {/* cursor-not-allowed on a plain div: it is the only hover feedback an
          unavailable card gets, and without it the pointer stays a plain arrow,
          which says nothing either way. Deliberately no hover style beyond it --
          matching the custom lobby's Knockout card, which is the same mode said
          the same way on the other screen. */}
      <div className="flex cursor-not-allowed flex-col items-start gap-1 rounded-lg border border-border bg-surface p-4 text-left opacity-60">
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

      {/* Under Knockout, not above it: the two live modes are not adjacent
          because Custom is the deliberate, bring-your-own-opponent option
          rather than a second way to play a stranger. Same card style as Duel
          -- an enabled card, so the disabled Knockout one sits between them and
          reads as the odd one out rather than as the end of the list. */}
      <button
        type="button"
        onClick={onSelectCustom}
        className="flex flex-col items-start gap-1 rounded-lg border border-border bg-surface-2 p-4 text-left transition hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="text-base font-bold text-text">Custom</span>
        <span className="text-sm text-text-muted">
          Play a friend with a code. Pick the rounds, the clock and the drivers — nothing counts toward your
          rating.
        </span>
      </button>
    </div>
  );
}
