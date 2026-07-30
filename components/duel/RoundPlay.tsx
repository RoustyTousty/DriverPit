"use client";

import { useEffect, useMemo, useRef } from "react";

import { DriverAutocomplete, type DriverOption } from "@/components/game/DriverAutocomplete";
import { MAX_ROUNDS } from "@/lib/duel/liveMatch";
import { DUEL_BASELINE, liveScore, proximityPoints } from "@/lib/game/duelScoring";
import { useSettings } from "@/lib/settings/useSettings";

import { ClosestGuessesBoard, type RankedGuess } from "./ClosestGuessesBoard";
import { OpponentPanel } from "./OpponentPanel";
import { RoundResultCards, type RoundResult } from "./RoundResultCards";
import { TugOfWarBar } from "./TugOfWarBar";

function formatSeconds(ms: number): string {
  return String(Math.ceil(ms / 1000)).padStart(2, "0");
}

interface OpponentProgress {
  guessCount: number;
  bestHeat: number;
  provisionalPoints: number;
  solved: boolean;
  solvedPoints: number | null;
}

export function RoundPlay({
  me,
  opponent,
  roundIndex,
  remainingMs,
  confirmedScoreA,
  confirmedScoreB,
  isPlayerA,
  completedRounds,
  eligibleDrivers,
  onGuess,
  pendingGuess,
}: {
  me: {
    handle: string;
    avatarUrl: string;
    guesses: RankedGuess[];
    solved: boolean;
    roundPoints: number | null;
    // Null on a round resumed after the fact -- duel_state reports that I
    // solved, not when, so the card drops the time rather than inventing one.
    solveMs: number | null;
  };
  opponent: { handle: string; avatarUrl: string; progress: OpponentProgress };
  roundIndex: number;
  remainingMs: number;
  // Confirmed score as of the *start* of this round -- deliberately not the
  // match's live running total. The moment either side solves, the RPC
  // writes that round's points into duel_matches.score_a/b immediately
  // (round-close hasn't happened yet) -- feeding that live total in here
  // would double it with `provisional` below, which represents this same
  // round's points a second way. See DuelMatch.tsx's roundStartScoreA/BRef.
  confirmedScoreA: number;
  confirmedScoreB: number;
  isPlayerA: boolean;
  completedRounds: RoundResult[];
  eligibleDrivers: DriverOption[];
  onGuess: (driver: DriverOption) => void;
  pendingGuess: boolean;
}) {
  const { showFlags } = useSettings();
  const timeUp = remainingMs <= 0;

  // Live standing (CLAUDE.md's Duel "Live standing"): baseline + confirmed
  // round points (already closed rounds) + this round's provisional --
  // locked speed points once solved, else the best proximity among guesses
  // so far. Derived straight from state already held here (myGuesses, the
  // opponent's last guess/solved broadcast), so the tug bar moves on every new
  // best guess and jumps on a solve, not only when duel_close_round actually
  // closes the round.
  //
  // Memoized on the guess list rather than recomputed per render because this
  // component re-renders on every countdown tick and the proximity scan is
  // field math over every guess of the round -- 10x a second for a value that
  // only changes when a guess lands (audit 2026-07-27 §1.0).
  const myConfirmed = isPlayerA ? confirmedScoreA : confirmedScoreB;
  const opponentConfirmed = isPlayerA ? confirmedScoreB : confirmedScoreA;
  const bestProximity = useMemo(
    () => Math.max(0, ...me.guesses.map((g) => proximityPoints(g.result))),
    [me.guesses],
  );

  // Withheld from the suggestions, same as daily/infinite (audit 2026-07-29
  // §4.7). Guesses are unlimited here so a duplicate costs no turn -- it costs
  // *seconds*, in the one mode where the clock is the score. `me.guesses` is
  // per-round (adoptRound clears it), so a driver guessed in round 1 is
  // suggestable again in round 2, where it's a different target.
  //
  // Memoized on the same dependency as the scan above, so it holds across the
  // 10Hz countdown re-renders instead of handing DriverAutocomplete's memo() a
  // new Set ten times a second.
  const guessedDriverIds = useMemo(
    () => new Set(me.guesses.map((g) => g.guessedDriver.id)),
    [me.guesses],
  );
  const myProvisional = me.solved ? (me.roundPoints ?? 0) : bestProximity;
  const opponentProvisional = opponent.progress.solved
    ? (opponent.progress.solvedPoints ?? 0)
    : opponent.progress.provisionalPoints;
  const liveMine = liveScore({ baseline: DUEL_BASELINE, confirmedPoints: myConfirmed, provisional: myProvisional });
  const liveOpponent = liveScore({ baseline: DUEL_BASELINE, confirmedPoints: opponentConfirmed, provisional: opponentProvisional });

  // Stable prop objects, so OpponentPanel's memo() actually holds across the
  // ticks: a fresh literal every render would defeat it on identity alone.
  const myPanelStats = useMemo(
    () => ({ handle: me.handle, avatarUrl: me.avatarUrl, livePoints: liveMine, guessCount: me.guesses.length }),
    [me.handle, me.avatarUrl, liveMine, me.guesses.length],
  );
  const opponentPanelStats = useMemo(
    () => ({
      handle: opponent.handle,
      avatarUrl: opponent.avatarUrl,
      livePoints: liveOpponent,
      guessCount: opponent.progress.guessCount,
    }),
    [opponent.handle, opponent.avatarUrl, liveOpponent, opponent.progress.guessCount],
  );

  // Solving unmounts DriverAutocomplete, which is where the keyboard player's
  // focus was -- so focus dropped to <body> and Tab restarted from the top of
  // the page, mid-match, at the one moment they most need to stay put (audit
  // 2026-07-29 §4.7). The solved panel replaces the input in the same slot, so
  // it takes the focus too; being focused is also what gets the points read
  // out, since a region that mounts already populated is unreliably announced.
  //
  // Same shape and same guard as PoolSelect's restore (§4.5): only claim focus
  // if it was genuinely lost. If the player has opened the exit modal or tabbed
  // to something deliberately, taking it back would be the worse bug.
  const solvedPanelRef = useRef<HTMLDivElement>(null);
  const wasSolvedRef = useRef(me.solved);
  useEffect(() => {
    const justSolved = me.solved && !wasSolvedRef.current;
    wasSolvedRef.current = me.solved;
    // Not on mount: a client resuming mid-round arrives already solved, and
    // there is no focus of theirs to restore.
    if (!justSolved) return;
    const active = document.activeElement;
    if (!active || active === document.body) solvedPanelRef.current?.focus();
  }, [me.solved]);

  return (
    <div className="flex flex-col gap-4 px-4 py-6">
      <TugOfWarBar liveMine={liveMine} liveOpponent={liveOpponent} />

      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text-muted">
          Round {roundIndex + 1} / {MAX_ROUNDS}
        </span>
        <span
          className={`font-mono text-2xl font-bold tabular-nums ${timeUp ? "text-red-400" : "text-text"}`}
          aria-live="polite"
        >
          0:{formatSeconds(remainingMs)}
        </span>
      </div>

      <OpponentPanel
        me={myPanelStats}
        opponent={opponentPanelStats}
        opponentBestHeat={opponent.progress.bestHeat}
        opponentSolved={opponent.progress.solved}
        opponentSolvedPoints={opponent.progress.solvedPoints}
      />

      <RoundResultCards results={completedRounds} />

      {/* Once solved, the input is dead weight -- it can't be used, and its
          "Solved — waiting on your opponent…" placeholder said the same thing
          as the line beneath it. It's replaced outright by what the player
          actually earned, which they'd otherwise not learn until the
          intermission. Green (--correct, the solved colour in the tile
          tokens), never accent: this is a passive result, and orange belongs
          to the tug bar directly above it -- two loud oranges competing is
          what made the old line read as shouting. */}
      {me.solved ? (
        <div className="flex flex-col gap-1">
          <div
            ref={solvedPanelRef}
            // Programmatic focus target only -- never in the tab order, so a
            // player who tabs past it once doesn't have to tab past it again.
            tabIndex={-1}
            className="flex items-center justify-between gap-3 rounded-lg border border-correct/40 bg-correct/10 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="text-xs font-semibold tracking-wide text-correct uppercase">Solved</span>
            <span className="flex items-baseline gap-3 font-mono tabular-nums">
              {me.solveMs !== null && (
                <span className="text-sm text-text-muted">{(me.solveMs / 1000).toFixed(1)}s</span>
              )}
              <span className="text-lg font-bold text-correct">+{me.roundPoints ?? 0}</span>
            </span>
          </div>

          {/* Turns dead waiting into the only thing that still matters: the
              timer is already on screen, this just points it at your time. */}
          <p className="text-center text-xs text-text-muted" aria-live="polite">
            {opponent.progress.solved
              ? `${opponent.handle} solved it too.`
              : timeUp
                ? `${opponent.handle} ran out of time.`
                : me.solveMs !== null
                  ? `${opponent.handle} has ${formatSeconds(remainingMs)}s to beat ${(me.solveMs / 1000).toFixed(1)}s.`
                  : `${opponent.handle} has ${formatSeconds(remainingMs)}s left.`}
          </p>
        </div>
      ) : (
        <DriverAutocomplete
          drivers={eligibleDrivers}
          onSelect={onGuess}
          disabled={pendingGuess || timeUp}
          placeholder="Guess a driver…"
          guessedDriverIds={guessedDriverIds}
        />
      )}

      {!me.solved && timeUp && <p className="text-center text-sm text-text-muted">Time's up for this round.</p>}

      <ClosestGuessesBoard guesses={me.guesses} pending={pendingGuess} showFlags={showFlags} />
    </div>
  );
}
