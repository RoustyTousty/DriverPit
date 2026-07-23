"use client";

import { useEffect, useRef, useState } from "react";

import { AvatarGlyph } from "@/components/ui/AvatarGlyph";
import { Flag } from "@/components/ui/Flag";
import { DriverCodeBadge, Tile } from "@/components/game/GuessGrid";
import type { DuelRevealedDriver } from "@/lib/db/duelRpc";
import type { DuelChannelState } from "@/lib/duel/useDuelChannel";
import { DUEL_BASELINE } from "@/lib/game/duelScoring";
import { POINTS_COUNT_UP_MS, READY_TIMEOUT_MS } from "@/lib/game/duelTiming";
import { countryCode } from "@/lib/game/flags";
import { usePrefersReducedMotion } from "@/lib/settings/usePrefersReducedMotion";
import { useSettings } from "@/lib/settings/useSettings";

import { TugOfWarBar } from "./TugOfWarBar";
import { useCountUp } from "./useCountUp";
import { useServerCountdown } from "./useServerCountdown";

interface IntermissionPlayer {
  handle: string;
  avatarUrl: string;
  roundPoints: number;
}

// CLAUDE.md's Duel "Intermission" beat -- this directly fixes "too fast,
// can't see the driver": the reveal, point count-up, and bar settle are
// all visible for the full server-stamped intermissionEndsAt (same length
// for both clients), and the *next* round is gated on both sides
// reconfirming ready, not just the clock running out.
export function DuelIntermission({
  me,
  opponent,
  roundIndex,
  isLastRound,
  targetDriver,
  startScoreMine,
  startScoreOpponent,
  endScoreMine,
  endScoreOpponent,
  intermissionEndsAt,
  clockOffsetMs,
  channel,
  onDone,
}: {
  me: IntermissionPlayer;
  opponent: IntermissionPlayer;
  roundIndex: number;
  isLastRound: boolean;
  targetDriver: DuelRevealedDriver;
  // Confirmed score *before* this round closed -- the tug bar's settle
  // animation starts here and eases to the end score below, reusing the
  // same live-updating TugOfWarBar (its own transition does the work).
  startScoreMine: number;
  startScoreOpponent: number;
  endScoreMine: number;
  endScoreOpponent: number;
  intermissionEndsAt: string;
  clockOffsetMs: number;
  channel: DuelChannelState;
  // Called exactly once, either once the mini-countdown ends (last round --
  // nothing left to gate) or once the post-countdown ready-gate passes
  // (both ready, or READY_TIMEOUT_MS). The caller decides what "done" means
  // (begin the next round, or move to match end).
  onDone: () => void;
}) {
  const { showFlags, reducedMotion: appReducedMotion } = useSettings();
  // Either signal snaps the JS-driven count-up: the OS media query (which
  // Tailwind's motion-reduce: covers for CSS, but not for rAF loops) OR the
  // in-app toggle (which the global data-attribute rule covers for CSS,
  // but likewise never touches JS animation).
  const reducedMotion = usePrefersReducedMotion() || appReducedMotion;

  // Fresh ready-gate for *this* intermission -- without an explicit reset,
  // a `ready: true` left over from the previous round's gate (or the
  // pre-match one) would trivially satisfy this one on mount.
  useEffect(() => {
    channel.resetReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The "entering" trick (see components/ui/Modal.tsx): render the bar at
  // its pre-round-close position on the first paint, then flip to the
  // confirmed post-round position a frame later so TugOfWarBar's own CSS
  // transition actually has something to animate across, instead of
  // mounting already-settled.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const myCountUp = useCountUp(me.roundPoints, POINTS_COUNT_UP_MS, reducedMotion);
  const opponentCountUp = useCountUp(opponent.roundPoints, POINTS_COUNT_UP_MS, reducedMotion);

  const remainingMs = useServerCountdown(intermissionEndsAt, clockOffsetMs);
  const countdownDone = remainingMs <= 0;
  const countdownDoneRef = useRef(false);
  const [readySent, setReadySent] = useState(false);
  const [readyTimedOut, setReadyTimedOut] = useState(false);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!countdownDone || countdownDoneRef.current) return;
    countdownDoneRef.current = true;
    if (isLastRound) {
      // Nothing to synchronize the *start* of -- match end doesn't need a
      // ready-gate, just the reveal to have played out.
      if (!doneRef.current) {
        doneRef.current = true;
        onDoneRef.current();
      }
      return;
    }
    channel.sendReady();
    setReadySent(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdownDone, isLastRound]);

  // Fallback if the opponent never reports ready -- starts once *I've*
  // sent my own (duelTiming.ts's own framing), same pattern as the
  // pre-match gate in DuelRoot.
  useEffect(() => {
    if (!readySent) return;
    const timeout = setTimeout(() => setReadyTimedOut(true), READY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [readySent]);

  useEffect(() => {
    if (!readySent || doneRef.current) return;
    if (channel.ready && (channel.opponentReady || readyTimedOut)) {
      doneRef.current = true;
      onDoneRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readySent, channel.ready, channel.opponentReady, readyTimedOut]);

  const nationalityValue =
    showFlags && countryCode(targetDriver.nationality) ? (
      <Flag nationality={targetDriver.nationality} className="text-2xl" />
    ) : (
      targetDriver.nationality
    );

  const waitingOnOpponent = readySent && !channel.opponentReady && !readyTimedOut;

  return (
    <div className="flex flex-col items-center gap-5 px-4 py-8 text-center">
      <p className="text-xs font-semibold tracking-wide text-accent uppercase">Round {roundIndex + 1} result</p>

      <p className="text-lg font-bold text-text">{targetDriver.fullName}</p>

      <div className="flex w-full gap-1 [perspective:600px]">
        <DriverCodeBadge code={targetDriver.driverCode} />
        <Tile feedback="exact">{nationalityValue}</Tile>
        <Tile feedback="exact">{targetDriver.team}</Tile>
        <Tile feedback="correct">{targetDriver.age}</Tile>
        <Tile feedback="correct">{targetDriver.debutYear}</Tile>
        <Tile feedback="correct">{targetDriver.careerWins}</Tile>
      </div>

      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex flex-1 flex-col items-center gap-1">
          <AvatarGlyph avatarUrl={me.avatarUrl} size="sm" />
          <p className="max-w-full truncate text-xs font-semibold text-text">{me.handle}</p>
          <p className="font-mono text-lg font-bold tabular-nums text-accent">+{myCountUp}</p>
        </div>
        <div className="flex flex-1 flex-col items-center gap-1">
          <AvatarGlyph avatarUrl={opponent.avatarUrl} size="sm" />
          <p className="max-w-full truncate text-xs font-semibold text-text">{opponent.handle}</p>
          <p className="font-mono text-lg font-bold tabular-nums text-text-muted">+{opponentCountUp}</p>
        </div>
      </div>

      <TugOfWarBar
        liveMine={DUEL_BASELINE + (settled ? endScoreMine : startScoreMine)}
        liveOpponent={DUEL_BASELINE + (settled ? endScoreOpponent : startScoreOpponent)}
      />

      {!isLastRound && (
        <>
          <div className="font-mono text-3xl font-bold tabular-nums text-text" aria-live="polite">
            {countdownDone ? "" : Math.ceil(remainingMs / 1000)}
          </div>
          <p className="text-xs text-text-muted">
            {!countdownDone ? "Next round starting soon…" : waitingOnOpponent ? "Waiting for opponent…" : "Get ready…"}
          </p>
        </>
      )}
    </div>
  );
}
