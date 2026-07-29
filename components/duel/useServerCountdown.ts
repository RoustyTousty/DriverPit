"use client";

import { useEffect, useRef, useState } from "react";

import { COUNTDOWN_TICK_MS } from "@/lib/game/duelTiming";

// Counts down to an absolute server timestamp, correcting for clock skew
// between this client and the server (`clockOffsetMs`, estimated once per
// match via a round-trip ping -- see DuelMatch). "Corrected now" is
// `Date.now() + clockOffsetMs`, never the raw local clock, so two clients
// with different local time land on zero at the same wall-clock instant.
//
// The remaining time is computed directly in the render body (not read
// back out of state) specifically because `targetIso` starts out null
// (DuelMatch's `round` is null until the initial fetch/broadcast adopts
// one) and then flips to a real future timestamp on a single render, the
// same render `phase` flips to "playing". A `useState` initializer only
// runs once at mount, when the target was still null -- if the computed
// value lived in state, that first render after adopting a round would
// read back the *stale* mount-time value (0, since target was null then)
// instead of the real ~60s remaining. DuelMatch's round-expiry effect
// reads this same render's value to decide whether the round is already
// over, so that one stale 0 was enough to make a just-started round look
// instantly expired -- immediately advancing/finishing the match with no
// visible timer or lobby countdown. Deriving fresh on every render instead
// of caching in state closes that gap; the interval below only forces a
// re-render (via the tick counter) so the derived value keeps advancing,
// it doesn't hold the actual countdown value itself.
//
// The interval stops as soon as the deadline passes, and that is the whole
// point of it (audit 2026-07-27 §1.0). It used to stop only when the target
// went back to null, which nothing ever did: DuelMatch mounts two of these
// per match, so `remainingToStart` kept forcing renders for the entire 60s
// round while pinned at 0, and both kept going *forever* on the results
// screen -- a 20-30Hz idle re-render of the whole duel subtree on exactly
// the screen a player sits on longest. A countdown that has finished
// counting has nothing left to say; anything that still needs to animate
// past its deadline owns its own timer (see useLightsCountdown).
export function useServerCountdown(targetIso: string | null, clockOffsetMs: number): number {
  const target = targetIso ? new Date(targetIso).getTime() : null;
  const [, forceTick] = useState(0);

  // Read inside the interval without listing it as a dep. It's measured once
  // per match (DuelRoot's useServerClock) and passed straight down, so it
  // never actually changes mid-countdown -- but as a dep it would tear the
  // interval down and rebuild it if it ever did, losing the elapsed phase of
  // the tick for no benefit.
  const offsetRef = useRef(clockOffsetMs);
  offsetRef.current = clockOffsetMs;

  useEffect(() => {
    if (target === null) return;
    // Already elapsed when this target was adopted (a resume onto a finished
    // round, a rematch's stale round row): the render body below already
    // reports 0, so there is nothing to count toward.
    if (target - (Date.now() + offsetRef.current) <= 0) return;

    const interval = setInterval(() => {
      // Tick first, *then* stop. The render this forces is the one where the
      // value finally reads 0, and DuelMatch's round-expiry effect is waiting
      // for exactly that (`remainingToEnd > 0` going false) to fire its
      // idempotent duel_close_round. Clearing before the tick would leave the
      // last tick's worth of time on the clock and the round hanging on the
      // DUEL_POLL_INTERVAL_MS safety net instead.
      forceTick((n) => n + 1);
      if (target - (Date.now() + offsetRef.current) <= 0) clearInterval(interval);
    }, COUNTDOWN_TICK_MS);

    return () => clearInterval(interval);
  }, [target]);

  if (target === null) return 0;
  return Math.max(0, target - (Date.now() + clockOffsetMs));
}

// "Has this absolute server timestamp passed yet?" -- the same clock
// correction as above, for callers that only need the *edge*, not the number.
// One setTimeout landing exactly on the deadline instead of a 10Hz poll: the
// intermission used a full countdown purely to learn when it was over, at ~60
// renders per intermission for a value it deliberately no longer draws.
export function useServerDeadlinePassed(targetIso: string, clockOffsetMs: number): boolean {
  const [passed, setPassed] = useState(false);

  useEffect(() => {
    const remaining = new Date(targetIso).getTime() - (Date.now() + clockOffsetMs);
    if (remaining <= 0) {
      setPassed(true);
      return;
    }
    setPassed(false);
    const timeout = setTimeout(() => setPassed(true), remaining);
    return () => clearTimeout(timeout);
  }, [targetIso, clockOffsetMs]);

  return passed;
}
