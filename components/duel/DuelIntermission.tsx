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
import { tileValueLabel } from "@/lib/game/tileLabel";
import { usePrefersReducedMotion } from "@/lib/settings/usePrefersReducedMotion";
import { useSettings } from "@/lib/settings/useSettings";

import { TugOfWarBar } from "./TugOfWarBar";
import { useCountUp } from "./useCountUp";
import { useServerDeadlinePassed } from "./useServerCountdown";

interface IntermissionPlayer {
  handle: string;
  avatarUrl: string;
  roundPoints: number;
  // How many guesses that "+N" took. Since drizzle/0058 the count is half of
  // what the number means -- this is where a player finds out they were beaten
  // by someone slower who guessed better, which is otherwise invisible.
  //
  // Both sides are counts the round screen was already showing live (mine from
  // my own board, the opponent's from their `guess` broadcasts, which
  // OpponentPanel has been rendering all round), so nothing new is disclosed
  // and nothing here is acted on -- it sits beside the authoritative points
  // rather than being used to derive them.
  guessCount: number;
}

// Rendered even at zero ("0 guesses" is a real and pointed thing to have
// happened to a player), so the two columns never differ in height and the
// count doesn't look like it appeared because of something one side did.
function GuessCount({ count }: { count: number }) {
  return (
    <p className="font-mono text-[11px] tabular-nums text-text-muted">
      {count} {count === 1 ? "guess" : "guesses"}
    </p>
  );
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
  const { showFlags } = useSettings();
  // Snaps the JS-driven count-up under the OS media query. Read explicitly
  // because Tailwind's motion-reduce: variant only covers CSS animation and
  // transitions -- it never touches a rAF loop like useCountUp.
  const reducedMotion = usePrefersReducedMotion();

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

  // Only the *edge* is needed, never the number: this beat's remaining time
  // hasn't been drawn since the mini-countdown was removed (see the note by
  // the status line below), it just gates the ready-gate. It was still being
  // polled at 10Hz for ~60 renders an intermission on top of the two
  // DuelMatch was already running -- audit 2026-07-27 §1.0's worst screen.
  const countdownDone = useServerDeadlinePassed(intermissionEndsAt, clockOffsetMs);
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
    // No suppression needed: everything read here is either a dependency or a
    // ref. (It carried one until the rule was actually switched on and reported
    // it as suppressing nothing -- audit 2026-07-29 §0.5.)
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

      {/* The one tile row with no column headers above it, so the labels carry
          the column names as well as the values -- and there's no verdict to
          say here: these are the answer's stats, not a comparison. */}
      <div className="flex w-full gap-1 [perspective:600px]">
        <DriverCodeBadge code={targetDriver.driverCode} />
        {/* Same two columns carry a `title` as on the board rows, for the same
            reason and no others: these are the only values wide enough to
            clip out of a line-clamp-2 tile (audit 2026-07-30 §4.7). */}
        <Tile
          feedback="exact"
          label={tileValueLabel("nationality", targetDriver.nationality)}
          title={targetDriver.nationality}
        >
          {nationalityValue}
        </Tile>
        <Tile feedback="exact" label={tileValueLabel("team", targetDriver.team)} title={targetDriver.team}>
          {targetDriver.team}
        </Tile>
        <Tile feedback="correct" label={tileValueLabel("age", targetDriver.age)}>
          {targetDriver.age}
        </Tile>
        <Tile feedback="correct" label={tileValueLabel("debutYear", targetDriver.debutYear)}>
          {targetDriver.debutYear}
        </Tile>
        <Tile feedback="correct" label={tileValueLabel("careerWins", targetDriver.careerWins)}>
          {targetDriver.careerWins}
        </Tile>
      </div>

      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex flex-1 flex-col items-center gap-1">
          <AvatarGlyph avatarUrl={me.avatarUrl} size="sm" />
          <p className="max-w-full truncate text-xs font-semibold text-text">{me.handle}</p>
          <p className="font-mono text-lg font-bold tabular-nums text-accent">+{myCountUp}</p>
          <GuessCount count={me.guessCount} />
        </div>
        <div className="flex flex-1 flex-col items-center gap-1">
          <AvatarGlyph avatarUrl={opponent.avatarUrl} size="sm" />
          <p className="max-w-full truncate text-xs font-semibold text-text">{opponent.handle}</p>
          <p className="font-mono text-lg font-bold tabular-nums text-text-muted">+{opponentCountUp}</p>
          <GuessCount count={opponent.guessCount} />
        </div>
      </div>

      <TugOfWarBar
        liveMine={DUEL_BASELINE + (settled ? endScoreMine : startScoreMine)}
        liveOpponent={DUEL_BASELINE + (settled ? endScoreOpponent : startScoreOpponent)}
      />

      {/* The intermission's own countdown runs exactly as before -- it still
          gates the ready-gate and the next round -- but it is no longer drawn.
          A big ticking 5-4-3-2-1 here read as a second deadline stacked on the
          one the round itself just used, and turned a beat meant for reading
          the reveal into something to sit out. The lights countdown that
          follows is the only timer that needs to be seen. */}
      {!isLastRound && (
        <p className="text-xs text-text-muted" aria-live="polite">
          {!countdownDone ? "Next round starting soon…" : waitingOnOpponent ? "Waiting for opponent…" : "Get ready…"}
        </p>
      )}
    </div>
  );
}
