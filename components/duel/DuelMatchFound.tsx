"use client";

import { useEffect, useRef, useState } from "react";

import type { Profile } from "@/components/auth/AuthProvider";
import { AvatarGlyph } from "@/components/ui/AvatarGlyph";
import { MATCH_FOUND_HOLD_MS } from "@/lib/game/duelTiming";

import { RatingBadge } from "./MatchFoundReveal";

export interface DuelOpponentSummary {
  username: string;
  displayName: string | null;
  avatarUrl: string;
  rating: number | null;
  duelWins: number;
  duelLosses: number;
}

function RecordBadge({ wins, losses }: { wins: number; losses: number }) {
  return (
    <p className="font-mono text-xs tabular-nums text-text-muted">
      {wins}-{losses}
    </p>
  );
}

// CLAUDE.md's Duel "Flow" step 3 (match-found staging): both avatars slide
// in from opposite sides -- two cars rolling onto a starting grid -- with
// handle, rating, and duel W/L for each. Held for MATCH_FOUND_HOLD_MS
// before onHoldComplete fires; the orchestrator calls sendReady() at that
// point and starts the ready-gate (both ready, or READY_TIMEOUT_MS).
// `waitingOnOpponent` covers the -- usually brief -- gap after the hold
// ends but before both sides have reported ready.
export function DuelMatchFound({
  me,
  myRating,
  myDuelWins,
  myDuelLosses,
  opponent,
  waitingOnOpponent,
  onHoldComplete,
}: {
  me: Profile;
  myRating: number | null;
  myDuelWins: number;
  myDuelLosses: number;
  opponent: DuelOpponentSummary;
  waitingOnOpponent: boolean;
  onHoldComplete: () => void;
}) {
  const [entered, setEntered] = useState(false);
  // Latest onHoldComplete, read when the hold timer fires -- avoids
  // resetting the timer (and replaying the slide-in) if the orchestrator
  // re-renders with a new function identity before the hold elapses.
  const completeRef = useRef(onHoldComplete);
  completeRef.current = onHoldComplete;

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    const timeout = setTimeout(() => completeRef.current(), MATCH_FOUND_HOLD_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-6 px-4 py-10 text-center">
      <p className="text-xs font-semibold tracking-wide text-accent uppercase">Opponent found</p>

      <div className="flex w-full items-center justify-center gap-4">
        <div
          className={`flex flex-1 flex-col items-center gap-2 transition-all duration-500 motion-reduce:transition-none ${
            entered ? "translate-x-0 opacity-100" : "-translate-x-12 opacity-0"
          }`}
        >
          <AvatarGlyph avatarUrl={me.avatarUrl} size="md" />
          <p className="max-w-full truncate text-sm font-semibold text-text">{me.displayName || me.username}</p>
          <RatingBadge rating={myRating} />
          <RecordBadge wins={myDuelWins} losses={myDuelLosses} />
        </div>

        <span className="text-lg font-bold text-text-muted">VS</span>

        <div
          className={`flex flex-1 flex-col items-center gap-2 transition-all duration-500 motion-reduce:transition-none ${
            entered ? "translate-x-0 opacity-100" : "translate-x-12 opacity-0"
          }`}
        >
          <AvatarGlyph avatarUrl={opponent.avatarUrl} size="md" />
          <p className="max-w-full truncate text-sm font-semibold text-text">
            {opponent.displayName || opponent.username}
          </p>
          <RatingBadge rating={opponent.rating} />
          <RecordBadge wins={opponent.duelWins} losses={opponent.duelLosses} />
        </div>
      </div>

      <p className="text-xs text-text-muted" aria-live="polite">
        {waitingOnOpponent ? "Waiting for opponent…" : "Get ready…"}
      </p>
    </div>
  );
}
