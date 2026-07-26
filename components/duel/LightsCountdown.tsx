import { Spinner } from "@/components/ui/Spinner";

import { LIGHT_COUNT } from "./useLightsCountdown";

// The one F1 lights-out countdown visual, shared by every duel pre-round
// beat -- round 1 of a fresh match, a rematch's round 1, and the mini
// countdown between every later round -- so "a timer before each game" is
// never a different UI depending on how that round started (CLAUDE.md's
// Duel visual-consistency principle, applied to the countdown itself, not
// just the guess board). Purely presentational: `litCount`/`isGo` are
// owned by the caller's useLightsCountdown, which is the one place that
// decides pacing (see that hook for why it isn't driven by seconds
// remaining). The number counts down -- 5, 4, 3, 2, 1, GO! -- and is derived
// from litCount rather than being a separately-computed clock, so it can never
// drift out of sync with the lights it labels.
export function LightsCountdown({
  litCount,
  isGo,
  loading = false,
}: {
  litCount: number;
  isGo: boolean;
  loading?: boolean;
}) {
  // The number names the light that just came on: L1 lit = 5, L5 lit = 1. NOT
  // "lights remaining" (LIGHT_COUNT - litCount), which showed 4 the moment the
  // first light came on and 0 once all five were lit -- a count that never
  // agreed with what was on screen. Floored at 1 so the `loading` litCount of 0
  // can't surface a 6; that path renders the spinner below anyway.
  const countLabel = Math.max(1, LIGHT_COUNT + 1 - litCount);

  return (
    <>
      <div className="flex gap-3" role="presentation">
        {Array.from({ length: LIGHT_COUNT }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={`h-5 w-5 rounded-full border-2 transition-colors duration-300 motion-reduce:transition-none ${
              !isGo && i < litCount ? "border-accent bg-accent" : "border-border bg-surface-2"
            }`}
          />
        ))}
      </div>

      {loading ? (
        // duel_begin_round hasn't resolved yet -- a neutral spinner, not a
        // number, since there's nothing to count down from at all yet (a
        // bare 5 here would misleadingly suggest the countdown had
        // actually started).
        <Spinner size="md" />
      ) : (
        <div
          className={`font-mono text-5xl font-bold tabular-nums transition-colors motion-reduce:transition-none ${
            isGo ? "text-accent" : "text-text"
          }`}
          aria-live="polite"
        >
          {isGo ? "GO!" : countLabel}
        </div>
      )}
    </>
  );
}
