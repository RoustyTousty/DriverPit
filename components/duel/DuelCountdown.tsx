"use client";

import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui/Toast";
import { beginRound } from "@/lib/duel/actions";

import { LightsCountdown } from "./LightsCountdown";
import { useLightsCountdown } from "./useLightsCountdown";
import { useServerCountdown } from "./useServerCountdown";

// CLAUDE.md's Duel "Flow" step 4: once the ready-gate passes (both ready or
// READY_TIMEOUT_MS, decided by the orchestrator before this mounts), stamp
// round 0's clock via duel_begin_round and run the F1 five-lights countdown
// to that absolute started_at. Reduced motion is handled by the app's
// existing infra, not bespoke logic here: the global
// `[data-reduced-motion="true"] *` rule (app globals.css) collapses every
// transition-duration to ~0 for the in-app setting, and `motion-reduce:`
// utility classes read the OS-level media query natively -- both already
// cover "snap instead of animate," this component just has to use real CSS
// transitions rather than skip them.
export function DuelCountdown({
  matchId,
  roundIndex,
  clockOffsetMs,
  onGo,
}: {
  matchId: number;
  roundIndex: number;
  clockOffsetMs: number;
  onGo: () => void;
}) {
  const toast = useToast();
  const [round, setRound] = useState<{ startedAt: string } | null>(null);
  const firedRef = useRef(false);
  const onGoRef = useRef(onGo);
  onGoRef.current = onGo;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await beginRound(matchId, roundIndex);
      if (cancelled) return;
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setRound({ startedAt: res.startedAt });
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId, roundIndex, toast]);

  const remainingMs = useServerCountdown(round?.startedAt ?? null, clockOffsetMs);
  const { litCount, isGo, holdComplete } = useLightsCountdown(remainingMs, round?.startedAt ?? null, round === null);

  useEffect(() => {
    if (holdComplete && !firedRef.current) {
      firedRef.current = true;
      onGoRef.current();
    }
  }, [holdComplete]);

  return (
    <div className="flex flex-col items-center gap-6 px-4 py-10 text-center">
      <p className="text-sm text-text-muted">Round {roundIndex + 1} starting…</p>
      <LightsCountdown litCount={litCount} isGo={isGo} loading={round === null} />
    </div>
  );
}
