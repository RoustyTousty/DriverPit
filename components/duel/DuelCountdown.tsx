"use client";

import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui/Toast";
import { beginRound } from "@/lib/duel/actions";
import { COUNTDOWN_MS } from "@/lib/game/duelTiming";

import { useServerCountdown } from "./useServerCountdown";

const LIGHT_COUNT = 5;
const LIGHT_INTERVAL_MS = COUNTDOWN_MS / LIGHT_COUNT;

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
  const isGo = round !== null && remainingMs <= 0;
  const elapsedMs = round ? COUNTDOWN_MS - remainingMs : 0;
  const litCount = Math.min(LIGHT_COUNT, Math.max(0, Math.floor(elapsedMs / LIGHT_INTERVAL_MS)));

  useEffect(() => {
    if (isGo && !firedRef.current) {
      firedRef.current = true;
      onGoRef.current();
    }
  }, [isGo]);

  return (
    <div className="flex flex-col items-center gap-6 px-4 py-10 text-center">
      <p className="text-sm text-text-muted">Round {roundIndex + 1} starting…</p>

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

      {round === null ? (
        // duel_begin_round hasn't resolved yet -- a neutral spinner, not a
        // number, since remainingMs is meaningless before there's an
        // absolute started_at to count down to (a bare 0 here would
        // misleadingly flash as if the countdown had already finished).
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
          {isGo ? "GO!" : Math.ceil(remainingMs / 1000)}
        </div>
      )}
    </div>
  );
}
