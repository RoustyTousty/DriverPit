"use client";

import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui/Toast";
import { beginRound } from "@/lib/duel/roundLifecycle";

import { LightsCountdown } from "./LightsCountdown";
import { useLightsCountdown } from "./useLightsCountdown";
import { useServerCountdown } from "./useServerCountdown";

// CLAUDE.md's Duel "Flow" step 4: once the ready-gate passes (both ready or
// READY_TIMEOUT_MS, decided by the orchestrator before this mounts), stamp
// round 0's clock via duel_begin_round and run the F1 five-lights countdown
// to that absolute started_at. Reduced motion is handled by the app's existing
// infra, not bespoke logic here: `motion-reduce:` utility classes read the OS
// `prefers-reduced-motion` media query natively, which already covers "snap
// instead of animate" -- this component just has to use real CSS transitions
// rather than skip them.
export function DuelCountdown({
  matchId,
  roundIndex,
  clockOffsetMs,
  onGo,
}: {
  matchId: number;
  roundIndex: number;
  clockOffsetMs: number;
  // Hands the stamped round on rather than just signalling "go": the next
  // screen would otherwise re-fetch timings this component was already given,
  // and pay a Server Action round trip for it while the round clock runs.
  onGo: (round: { roundIndex: number; startedAt: string; endsAt: string }) => void;
}) {
  const toast = useToast();
  const [round, setRound] = useState<{ startedAt: string; endsAt: string } | null>(null);
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
      setRound({ startedAt: res.startedAt, endsAt: res.endsAt });
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId, roundIndex, toast]);

  const remainingMs = useServerCountdown(round?.startedAt ?? null, clockOffsetMs);
  const { litCount, isGo, holdComplete } = useLightsCountdown(remainingMs, round?.startedAt ?? null, round === null);

  useEffect(() => {
    if (holdComplete && !firedRef.current && round) {
      firedRef.current = true;
      onGoRef.current({ roundIndex, startedAt: round.startedAt, endsAt: round.endsAt });
    }
  }, [holdComplete, round, roundIndex]);

  return (
    <div className="flex flex-col items-center gap-6 px-4 py-10 text-center">
      <p className="text-sm text-text-muted">Round {roundIndex + 1} starting…</p>
      <LightsCountdown litCount={litCount} isGo={isGo} loading={round === null} />
    </div>
  );
}
