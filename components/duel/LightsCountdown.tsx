import { LIGHT_COUNT } from "./useLightsCountdown";

// The one F1 lights-out countdown visual, shared by every duel pre-round
// beat -- round 1 of a fresh match, a rematch's round 1, and the mini
// countdown between every later round -- so "a timer before each game" is
// never a different UI depending on how that round started (CLAUDE.md's
// Duel visual-consistency principle, applied to the countdown itself, not
// just the guess board). Purely presentational: `litCount`/`isGo` are
// owned by the caller's useLightsCountdown, which is the one place that
// decides pacing (see that hook for why it isn't driven by seconds
// remaining). The number counts down (lights left to go), not up, so it
// reads the way a real start countdown does -- 5, 4, 3, 2, 1, GO! -- while
// staying tied to the same lights, never a separately-computed clock that
// can drift out of sync with them.
export function LightsCountdown({
  litCount,
  isGo,
  loading = false,
}: {
  litCount: number;
  isGo: boolean;
  loading?: boolean;
}) {
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
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : (
        <div
          className={`font-mono text-5xl font-bold tabular-nums transition-colors motion-reduce:transition-none ${
            isGo ? "text-accent" : "text-text"
          }`}
          aria-live="polite"
        >
          {isGo ? "GO!" : LIGHT_COUNT - litCount}
        </div>
      )}
    </>
  );
}
