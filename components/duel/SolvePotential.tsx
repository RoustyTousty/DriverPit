"use client";

import { useEffect, useRef, useState } from "react";

import { accuracyFactor, solvePoints } from "@/lib/game/duelScoring";

// How long the "−52" sits there after a wrong guess. Long enough to read
// mid-round without becoming something to wait out.
const DROP_VISIBLE_MS = 1_400;

// The readout ticks 10x a second off the round clock, and a number sliding
// 487 -> 486 -> 485 in that window is noise, not information -- the player is
// being told an order of magnitude ("still worth a lot", "nearly nothing"), so
// it steps in fives. tabular-nums keeps the width fixed either way.
const STEP = 5;

function stepped(points: number): number {
  return Math.round(points / STEP) * STEP;
}

// What solving RIGHT NOW would pay -- the time falloff and the wrong-guess
// decay (drizzle/0058) folded into the one number the game already speaks in
// ("+140" on the solved panel, "+N" in the intermission). This is the whole
// player-facing explanation of guess discipline: nobody has to be taught a
// formula, they watch the number drop when they spray and hold when they
// think.
//
// Deliberately its own component rather than markup inside RoundPlay: the drop
// flash is timer-driven state, and CLAUDE.md's rule is that ticking state lives
// in the leaf that renders it. Here that also keeps the setTimeout from
// re-rendering the guess board and the opponent panel beside it.
export function SolvePotential({
  roundMs,
  remainingMs,
  wrongGuesses,
}: {
  roundMs: number;
  remainingMs: number;
  // Guesses that were NOT the answer. The solving guess is excluded by the
  // caller, exactly as duel_submit_guess excludes it server-side.
  wrongGuesses: number;
}) {
  const elapsed = roundMs - remainingMs;
  const potential = stepped(solvePoints(elapsed, roundMs, wrongGuesses));
  const accuracy = accuracyFactor(wrongGuesses);

  const [drop, setDrop] = useState<number | null>(null);

  // Read inside the effect below without being a dependency of it: what the
  // drop is worth depends on when the guess landed, and re-running the effect
  // on every tick would restart the flash 10x a second. Same ref-latch as
  // useDuelLifecycle's handleGuessRef.
  const latestRef = useRef({ elapsed, roundMs });
  latestRef.current = { elapsed, roundMs };
  const previousWrongRef = useRef(wrongGuesses);

  useEffect(() => {
    const previous = previousWrongRef.current;
    previousWrongRef.current = wrongGuesses;
    // Only ever fires going up. A new round resets the count to 0, which is a
    // fresh board rather than 5 guesses' worth of good news.
    if (wrongGuesses <= previous) return;

    const { elapsed: at, roundMs: length } = latestRef.current;
    const cost = stepped(solvePoints(at, length, previous)) - stepped(solvePoints(at, length, wrongGuesses));
    // Inside the free allowance there is nothing to report, and claiming "−0"
    // would teach the opposite of the rule.
    if (cost <= 0) return;

    setDrop(cost);
    const timeout = setTimeout(() => setDrop(null), DROP_VISIBLE_MS);
    return () => clearTimeout(timeout);
  }, [wrongGuesses]);

  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="flex items-baseline gap-2">
        <span className="text-xs text-text-muted">Solve now</span>
        <span className="font-mono text-base font-bold tabular-nums text-text">+{potential}</span>
        {/* Only once it is actually costing something. At x1.00 there is
            nothing to say, and a permanent multiplier would read as a warning
            about a rule the player has not broken. */}
        {accuracy < 1 && (
          <span className="font-mono text-xs tabular-nums text-text-muted">×{accuracy.toFixed(2)}</span>
        )}
      </span>

      {/* Persistently mounted, filled on demand: a live region that appears
          already populated is announced unreliably (same reason
          GuessAnnouncer is rendered up front and empty). Sits under the round
          clock, so the cost lands where the eye already is. */}
      <span role="status" className="font-mono text-sm font-semibold tabular-nums text-red-400">
        {drop !== null && (
          <span key={drop + wrongGuesses} className="animate-points-drop inline-block motion-reduce:animate-none">
            −{drop}
            <span className="sr-only"> points for that guess</span>
          </span>
        )}
      </span>
    </div>
  );
}
