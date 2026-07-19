import { DriverAutocomplete, type DriverOption } from "@/components/game/DriverAutocomplete";
import { GuessGrid, type Guess } from "@/components/game/GuessGrid";
import { MAX_ROUNDS } from "@/lib/duel/liveMatch";

function formatSeconds(ms: number): string {
  return String(Math.ceil(ms / 1000)).padStart(2, "0");
}

// Deliberately plain: countdown, guess input, guess grid, running score.
// No tug-of-war bar, no opponent feed, no closest-guesses ranking -- those
// are the themed-UI pass. Guesses are unlimited within the timer (unlike
// daily/infinite's fixed 5), so GuessGrid is given exactly as many empty
// slots as guesses made -- it never pads toward a max.
export function RoundPlay({
  roundIndex,
  remainingMs,
  myScore,
  opponentScore,
  myGuesses,
  eligibleDrivers,
  onGuess,
  disabled,
  mySolved,
  error,
}: {
  roundIndex: number;
  remainingMs: number;
  myScore: number;
  opponentScore: number;
  myGuesses: Guess[];
  eligibleDrivers: DriverOption[];
  onGuess: (driver: DriverOption) => void;
  disabled: boolean;
  mySolved: boolean;
  error: string | null;
}) {
  const timeUp = remainingMs <= 0;

  return (
    <div className="flex flex-col gap-4 px-4 py-6">
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

      <div className="flex items-center justify-center gap-3 rounded-lg border border-border bg-surface-2 px-4 py-2 font-mono text-sm tabular-nums">
        <span className="font-bold text-accent">{myScore}</span>
        <span className="text-text-muted">you</span>
        <span className="text-text-muted">—</span>
        <span className="text-text-muted">opponent</span>
        <span className="font-bold text-text">{opponentScore}</span>
      </div>

      <DriverAutocomplete
        drivers={eligibleDrivers}
        onSelect={onGuess}
        disabled={disabled || mySolved || timeUp}
        placeholder={mySolved ? "Solved — waiting on your opponent…" : "Guess a driver…"}
      />

      {error && (
        <p role="alert" className="text-center text-sm text-red-400">
          {error}
        </p>
      )}

      {mySolved && (
        <p className="text-center text-sm text-accent">Nice — waiting for the round to finish.</p>
      )}
      {!mySolved && timeUp && (
        <p className="text-center text-sm text-text-muted">Time's up for this round.</p>
      )}

      <GuessGrid guesses={myGuesses} maxGuesses={myGuesses.length} />
    </div>
  );
}
