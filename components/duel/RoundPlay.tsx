"use client";

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
  me: { handle: string; avatarUrl: string; guesses: RankedGuess[]; solved: boolean; roundPoints: number | null };
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
  // so far. Recomputed every render straight from state already held here
  // (myGuesses, the opponent's last guess/solved broadcast), so the tug bar
  // moves on every new best guess and jumps on a solve, not only when
  // duel_close_round actually closes the round.
  const myConfirmed = isPlayerA ? confirmedScoreA : confirmedScoreB;
  const opponentConfirmed = isPlayerA ? confirmedScoreB : confirmedScoreA;
  const myProvisional = me.solved
    ? (me.roundPoints ?? 0)
    : Math.max(0, ...me.guesses.map((g) => proximityPoints(g.result)));
  const opponentProvisional = opponent.progress.solved
    ? (opponent.progress.solvedPoints ?? 0)
    : opponent.progress.provisionalPoints;
  const liveMine = liveScore({ baseline: DUEL_BASELINE, confirmedPoints: myConfirmed, provisional: myProvisional });
  const liveOpponent = liveScore({ baseline: DUEL_BASELINE, confirmedPoints: opponentConfirmed, provisional: opponentProvisional });

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
        me={{ handle: me.handle, avatarUrl: me.avatarUrl, livePoints: liveMine, guessCount: me.guesses.length }}
        opponent={{
          handle: opponent.handle,
          avatarUrl: opponent.avatarUrl,
          livePoints: liveOpponent,
          guessCount: opponent.progress.guessCount,
        }}
        opponentBestHeat={opponent.progress.bestHeat}
        opponentSolved={opponent.progress.solved}
        opponentSolvedPoints={opponent.progress.solvedPoints}
      />

      <RoundResultCards results={completedRounds} />

      <DriverAutocomplete
        drivers={eligibleDrivers}
        onSelect={onGuess}
        disabled={pendingGuess || me.solved || timeUp}
        placeholder={me.solved ? "Solved — waiting on your opponent…" : "Guess a driver…"}
      />

      {me.solved && <p className="text-center text-sm text-accent">Nice — waiting for the round to finish.</p>}
      {!me.solved && timeUp && <p className="text-center text-sm text-text-muted">Time's up for this round.</p>}

      <ClosestGuessesBoard guesses={me.guesses} pending={pendingGuess} showFlags={showFlags} />
    </div>
  );
}
