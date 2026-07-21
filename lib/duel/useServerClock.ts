"use client";

import { useEffect, useState } from "react";

import { getServerTime } from "./serverClock";

export interface ServerClock {
  // Add this to Date.now() to get the estimated current server time.
  // 0 until the first ping resolves.
  clockOffsetMs: number;
  // Has the round-trip ping resolved at least once.
  measured: boolean;
}

// Pings server time once at mount to estimate clock offset (CLAUDE.md:
// "ping server time once to estimate offset"), the same round-trip-midpoint
// estimate DuelMatch's mount effect already computes inline
// (serverNow - (t0 + t1) / 2) -- factored out here so it isn't tied to a
// specific data fetch (getDuelRoundState) and any consumer can target
// absolute server timestamps, e.g. via useServerCountdown(targetIso,
// clockOffsetMs).
export function useServerClock(): ServerClock {
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [measured, setMeasured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const t0 = Date.now();
      const serverNowIso = await getServerTime();
      const t1 = Date.now();
      if (cancelled) return;
      setClockOffsetMs(new Date(serverNowIso).getTime() - (t0 + t1) / 2);
      setMeasured(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { clockOffsetMs, measured };
}
