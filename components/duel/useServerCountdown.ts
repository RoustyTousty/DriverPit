"use client";

import { useEffect, useState } from "react";

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
export function useServerCountdown(targetIso: string | null, clockOffsetMs: number): number {
  const target = targetIso ? new Date(targetIso).getTime() : null;
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (target === null) return;
    const interval = setInterval(() => forceTick((n) => n + 1), 100);
    return () => clearInterval(interval);
  }, [target]);

  if (target === null) return 0;
  return Math.max(0, target - (Date.now() + clockOffsetMs));
}
