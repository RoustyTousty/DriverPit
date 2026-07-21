"use client";

import { useEffect, useRef, useState } from "react";

import { AvatarGlyph } from "@/components/ui/AvatarGlyph";

export interface PlayerLiveStats {
  handle: string;
  avatarUrl: string;
  livePoints: number;
  guessCount: number;
}

// CLAUDE.md's "Live opponent presence": both avatars on screen the whole
// match, each with handle + live provisional points + guess count. My own
// side just reflects state I already caused (no extra animation needed --
// my own guess appearing in the board below is the feedback). The
// opponent's side is where the "rival closing in" read has to happen from
// abstracted signals alone: a pulse on every guess (guessCount ticking),
// a continuous glow scaled by their best heat (0-1), and a burst +
// "SOLVED +N" the moment they solve.
export function OpponentPanel({
  me,
  opponent,
  opponentBestHeat,
  opponentSolved,
  opponentSolvedPoints,
}: {
  me: PlayerLiveStats;
  opponent: PlayerLiveStats;
  opponentBestHeat: number;
  opponentSolved: boolean;
  opponentSolvedPoints: number | null;
}) {
  const [pulsing, setPulsing] = useState(false);
  const prevGuessCountRef = useRef(opponent.guessCount);
  useEffect(() => {
    if (opponent.guessCount === prevGuessCountRef.current) return;
    prevGuessCountRef.current = opponent.guessCount;
    setPulsing(true);
    const timeout = setTimeout(() => setPulsing(false), 400);
    return () => clearTimeout(timeout);
  }, [opponent.guessCount]);

  const [bursting, setBursting] = useState(false);
  const wasSolvedRef = useRef(opponentSolved);
  useEffect(() => {
    if (opponentSolved && !wasSolvedRef.current) {
      setBursting(true);
      const timeout = setTimeout(() => setBursting(false), 1500);
      wasSolvedRef.current = opponentSolved;
      return () => clearTimeout(timeout);
    }
    wasSolvedRef.current = opponentSolved;
  }, [opponentSolved]);

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <AvatarGlyph avatarUrl={me.avatarUrl} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-text">{me.handle}</p>
          <p className="font-mono text-xs tabular-nums text-text-muted">
            {Math.round(me.livePoints)} pts · {me.guessCount} guess{me.guessCount === 1 ? "" : "es"}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-row-reverse items-center gap-2 text-right">
        <div className="relative shrink-0">
          {/* Continuous glow, scaled by the opponent's best heat this round
              -- never their guessed driver, just how warm they're running. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 rounded-full transition-all duration-300 motion-reduce:transition-none"
            style={{
              boxShadow: `0 0 ${6 + opponentBestHeat * 18}px ${opponentBestHeat * 3}px rgba(255,106,0,${0.15 + opponentBestHeat * 0.55})`,
            }}
          />
          <div
            className={`transition-transform duration-300 motion-reduce:transition-none ${
              pulsing ? "scale-110" : "scale-100"
            }`}
          >
            <AvatarGlyph avatarUrl={opponent.avatarUrl} size="sm" />
          </div>
          {bursting && (
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full border-2 border-accent motion-safe:animate-ping motion-reduce:hidden"
            />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-text">{opponent.handle}</p>
          {bursting && opponentSolvedPoints !== null ? (
            <p className="font-mono text-xs font-bold tabular-nums text-accent" aria-live="polite">
              SOLVED +{opponentSolvedPoints}
            </p>
          ) : (
            <p className="font-mono text-xs tabular-nums text-text-muted">
              {Math.round(opponent.livePoints)} pts · {opponent.guessCount} guess{opponent.guessCount === 1 ? "" : "es"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
