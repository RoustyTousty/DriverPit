"use client";

import { DriverAutocomplete, type DriverOption } from "@/components/game/DriverAutocomplete";
import { MAX_ROUNDS } from "@/lib/duel/liveMatch";
import { useSettings } from "@/lib/settings/useSettings";

import { ClosestGuessesBoard, type RankedGuess } from "./ClosestGuessesBoard";
import { OpponentFeed } from "./OpponentFeed";
import { RoundResultCards, type RoundResult } from "./RoundResultCards";
import { TugOfWarBar } from "./TugOfWarBar";

function formatSeconds(ms: number): string {
  return String(Math.ceil(ms / 1000)).padStart(2, "0");
}

export function RoundPlay({
  roundIndex,
  remainingMs,
  myScore,
  opponentScore,
  myGuesses,
  completedRounds,
  opponentProgress,
  eligibleDrivers,
  onGuess,
  disabled,
  mySolved,
}: {
  roundIndex: number;
  remainingMs: number;
  myScore: number;
  opponentScore: number;
  myGuesses: RankedGuess[];
  completedRounds: RoundResult[];
  opponentProgress: { guessCount: number; bestHeat: number; solved: boolean };
  eligibleDrivers: DriverOption[];
  onGuess: (driver: DriverOption) => void;
  disabled: boolean;
  mySolved: boolean;
}) {
  const { showFlags } = useSettings();
  const timeUp = remainingMs <= 0;

  return (
    <div className="flex flex-col gap-4 px-4 py-6">
      <TugOfWarBar myScore={myScore} opponentScore={opponentScore} />

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

      <OpponentFeed
        guessCount={opponentProgress.guessCount}
        bestHeat={opponentProgress.bestHeat}
        solved={opponentProgress.solved}
      />

      <RoundResultCards results={completedRounds} />

      <DriverAutocomplete
        drivers={eligibleDrivers}
        onSelect={onGuess}
        disabled={disabled || mySolved || timeUp}
        placeholder={mySolved ? "Solved — waiting on your opponent…" : "Guess a driver…"}
      />

      {mySolved && (
        <p className="text-center text-sm text-accent">Nice — waiting for the round to finish.</p>
      )}
      {!mySolved && timeUp && (
        <p className="text-center text-sm text-text-muted">Time's up for this round.</p>
      )}

      <ClosestGuessesBoard guesses={myGuesses} showFlags={showFlags} />
    </div>
  );
}
