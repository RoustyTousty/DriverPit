"use client";

import { useEffect, useState } from "react";

// Counts down to an absolute server timestamp, correcting for clock skew
// between this client and the server (`clockOffsetMs`, estimated once per
// match via a round-trip ping -- see DuelMatch). "Corrected now" is
// `Date.now() + clockOffsetMs`, never the raw local clock, so two clients
// with different local time land on zero at the same wall-clock instant.
export function useServerCountdown(targetIso: string | null, clockOffsetMs: number): number {
  const target = targetIso ? new Date(targetIso).getTime() : null;

  const [remaining, setRemaining] = useState(() =>
    target === null ? 0 : Math.max(0, target - (Date.now() + clockOffsetMs)),
  );

  useEffect(() => {
    if (target === null) return;
    const tick = () => setRemaining(Math.max(0, target - (Date.now() + clockOffsetMs)));
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [target, clockOffsetMs]);

  return remaining;
}
